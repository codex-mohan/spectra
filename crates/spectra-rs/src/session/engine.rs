use crate::agent::{Agent, AgentConfig};
use crate::error::Result;
use crate::event::StreamEvent;
use crate::llm::LlmClient;
use crate::messages::Message;
use crate::session::{SessionConfig, SessionManager};
use std::sync::Arc;
use tokio::sync::watch;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EngineLifecycle {
    Stopped,
    Running,
    Draining,
}

pub struct SessionEngineConfig {
    pub session_manager: SessionManager,
    pub max_concurrent_sessions: usize,
    pub session_timeout_ms: u64,
}

impl Default for SessionEngineConfig {
    fn default() -> Self {
        Self {
            session_manager: SessionManager::new(Arc::new(
                crate::session::InMemorySessionStore::new(),
            )),
            max_concurrent_sessions: 100,
            session_timeout_ms: 300_000,
        }
    }
}

pub struct SessionEngineResult {
    pub session_id: String,
    pub events: Vec<StreamEvent>,
    pub final_message: String,
}

struct ActiveSession {
    abort_tx: watch::Sender<bool>,
}

pub struct SessionEngine {
    config: SessionEngineConfig,
    active_sessions: dashmap::DashMap<String, ActiveSession>,
    lifecycle: std::sync::Mutex<EngineLifecycle>,
}

impl SessionEngine {
    pub fn new(config: SessionEngineConfig) -> Self {
        Self {
            config,
            active_sessions: dashmap::DashMap::new(),
            lifecycle: std::sync::Mutex::new(EngineLifecycle::Stopped),
        }
    }

    pub fn lifecycle(&self) -> EngineLifecycle {
        *self.lifecycle.lock().unwrap()
    }

    pub fn active_session_count(&self) -> usize {
        self.active_sessions.len()
    }

    pub fn start(&self) {
        let mut lc = self.lifecycle.lock().unwrap();
        if *lc == EngineLifecycle::Stopped {
            *lc = EngineLifecycle::Running;
        }
    }

    pub async fn stop(&self, drain: bool) {
        {
            let mut lc = self.lifecycle.lock().unwrap();
            *lc = EngineLifecycle::Draining;
        }

        if drain {
            // Wait for active sessions to finish (up to 30s)
            let deadline = tokio::time::Instant::now() + tokio::time::Duration::from_secs(30);
            while !self.active_sessions.is_empty() && tokio::time::Instant::now() < deadline {
                tokio::time::sleep(tokio::time::Duration::from_millis(250)).await;
            }

            // Force abort any remaining
            for entry in self.active_sessions.iter() {
                let _ = entry.value().abort_tx.send(true);
            }
            self.active_sessions.clear();
        } else {
            for entry in self.active_sessions.iter() {
                let _ = entry.value().abort_tx.send(true);
            }
            self.active_sessions.clear();
        }

        let mut lc = self.lifecycle.lock().unwrap();
        *lc = EngineLifecycle::Stopped;
    }

    pub fn abort_session(&self, session_id: &str) {
        if let Some(entry) = self.active_sessions.get(session_id) {
            let _ = entry.value().abort_tx.send(true);
        }
        self.active_sessions.remove(session_id);
    }

    /// Run an agent turn, persisting each message as it completes.
    pub async fn run(
        &self,
        client: Arc<dyn LlmClient>,
        input: impl Into<String>,
        session_id: Option<String>,
        agent_config: &AgentConfig,
    ) -> Result<SessionEngineResult> {
        let lifecycle = { *self.lifecycle.lock().unwrap() };
        match lifecycle {
            EngineLifecycle::Stopped => {
                return Err(crate::error::SpectraError::ConfigError {
                    field: "lifecycle".into(),
                    detail: "Engine is stopped. Call start() first.".into(),
                });
            }
            EngineLifecycle::Draining => {
                return Err(crate::error::SpectraError::ConfigError {
                    field: "lifecycle".into(),
                    detail: "Engine is draining. No new sessions accepted.".into(),
                });
            }
            EngineLifecycle::Running => {}
        }

        if self.active_sessions.len() >= self.config.max_concurrent_sessions {
            return Err(crate::error::SpectraError::ConfigError {
                field: "concurrency".into(),
                detail: format!(
                    "Max concurrent sessions reached ({})",
                    self.config.max_concurrent_sessions
                ),
            });
        }

        // Load or create session
        let mut session = if let Some(sid) = &session_id {
            match self.config.session_manager.load(sid).await? {
                Some(s) => s,
                None => {
                    return Err(crate::error::SpectraError::ConfigError {
                        field: "session_id".into(),
                        detail: format!("Session not found: {sid}"),
                    });
                }
            }
        } else {
            let session_config = SessionConfig {
                model: agent_config.model.clone(),
                system_prompt: agent_config.system_prompt.clone(),
                max_turns: agent_config.max_turns,
                max_tokens: None,
                temperature: None,
                api_key: None,
            };
            self.config
                .session_manager
                .create(session_config, None)
                .await?
        };

        // Build agent with restored history
        let agent = Agent::new(client, agent_config.clone());
        let restored: Vec<Message> = session
            .entries
            .iter()
            .filter_map(|e| match e {
                crate::session::SessionEntry::Message(m) => Some((*m.message).clone()),
                _ => None,
            })
            .collect();
        agent.restore_history(restored).await;

        // Track this active session
        let (abort_tx, abort_rx) = watch::channel(false);
        let session_id_str = session.id.clone();
        self.active_sessions.insert(
            session_id_str.clone(),
            ActiveSession {
                abort_tx: abort_tx.clone(),
            },
        );

        // Run the agent loop with per-event persistence
        // Persist the user message now (agent loop doesn't emit MessageEnd for it)
        let input_str: String = input.into();
        let user_msg = Message::User(crate::messages::UserMessage::text(&input_str));
        self.config
            .session_manager
            .append_message(&mut session, user_msg);
        self.config.session_manager.save(&mut session).await?;

        let (mut rx, _channel, _handle) = agent.run(input_str).await?;
        let mut events = Vec::new();
        let mut final_message = String::new();

        let timeout = tokio::time::Duration::from_millis(self.config.session_timeout_ms);
        let deadline = tokio::time::Instant::now() + timeout;

        loop {
            if *abort_rx.borrow() {
                break;
            }
            if tokio::time::Instant::now() >= deadline {
                break;
            }

            tokio::select! {
                event = rx.recv() => {
                    match event {
                        Some(Ok(event)) => {
                            // Per-event persistence: save each message as it completes
                            if let StreamEvent::MessageEnd { ref message } = event {
                                self.config.session_manager.append_message(&mut session, message.clone());
                                self.config.session_manager.save(&mut session).await?;
                            }

                            if let StreamEvent::Audit { ref event_type, ref details, .. } = event {
                                self.config.session_manager.append_audit(
                                    &mut session,
                                    event_type.clone(),
                                    details.clone(),
                                );
                                self.config.session_manager.save(&mut session).await?;
                            }

                            // Track final message text
                            if let StreamEvent::TurnEnd { .. } = event {
                                // Extract text from the last assistant message in the turn
                                for entry in session.entries.iter().rev() {
                                    if let crate::session::SessionEntry::Message(m) = entry {
                                        if let Message::Assistant(ref am) = *m.message {
                                            if let Some(crate::messages::Content::Text { text }) = am.content.first() {
                                                final_message = text.clone();
                                            }
                                            break;
                                        }
                                    }
                                }
                            }

                            events.push(event);
                        }
                        Some(Err(e)) => {
                            events.push(StreamEvent::Error {
                                message: e.to_string(),
                            });
                            break;
                        }
                        None => break,
                    }
                }
                _ = tokio::time::sleep_until(deadline) => {
                    break;
                }
            }
        }

        // Cleanup
        self.active_sessions.remove(&session_id_str);

        Ok(SessionEngineResult {
            session_id: session_id_str,
            events,
            final_message,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::llm::{
        LlmClient, LlmRequest, LlmResponse, LlmStream, LlmStreamEvent, Model, Provider,
    };
    use crate::messages::{AssistantMessage, Content, StopReason, ToolCall};
    use crate::session::InMemorySessionStore;
    use async_trait::async_trait;
    use serde_json::json;

    struct MockLlmClient {
        respond_with_tool_call: bool,
    }

    #[async_trait]
    impl LlmClient for MockLlmClient {
        fn provider(&self) -> Provider {
            Provider::Custom
        }

        async fn complete(&self, _request: LlmRequest) -> Result<LlmResponse> {
            Ok(LlmResponse {
                message: AssistantMessage::new(vec![], vec![], StopReason::EndOfTurn),
                usage: Default::default(),
                stop_reason: StopReason::EndOfTurn,
            })
        }

        async fn stream(&self, _request: LlmRequest) -> Result<LlmStream> {
            let (tx, rx) = tokio::sync::mpsc::channel(8);
            if self.respond_with_tool_call {
                let msg = AssistantMessage::new(
                    vec![Content::Text {
                        text: "calling tool".into(),
                    }],
                    vec![ToolCall {
                        id: "tc-1".into(),
                        name: "test_tool".into(),
                        arguments: json!({}),
                        thinking_signature: None,
                    }],
                    StopReason::ToolCalls,
                );
                let _ = tx.send(Ok(LlmStreamEvent::Done { message: msg })).await;
            } else {
                let msg = AssistantMessage::new(
                    vec![Content::Text {
                        text: "final answer".into(),
                    }],
                    vec![],
                    StopReason::EndOfTurn,
                );
                let _ = tx.send(Ok(LlmStreamEvent::Done { message: msg })).await;
            }
            Ok(Box::pin(tokio_stream::wrappers::ReceiverStream::new(rx)))
        }
    }

    fn test_agent_config() -> AgentConfig {
        AgentConfig {
            model: Model::new(Provider::Custom, "test-model"),
            ..Default::default()
        }
    }

    #[tokio::test]
    async fn test_engine_run_persists_messages() {
        let store = Arc::new(InMemorySessionStore::new());
        let mgr = SessionManager::new(store.clone());
        let engine = SessionEngine::new(SessionEngineConfig {
            session_manager: mgr.clone(),
            ..Default::default()
        });
        engine.start();

        let client = Arc::new(MockLlmClient {
            respond_with_tool_call: false,
        });
        let config = test_agent_config();

        let result = engine.run(client, "hello", None, &config).await.unwrap();

        let loaded = engine
            .config
            .session_manager
            .load(&result.session_id)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(loaded.entries.len(), 2);
        match &loaded.entries[0] {
            crate::session::SessionEntry::Message(m) => {
                assert!(matches!(*m.message, Message::User(_)))
            }
            _ => panic!("expected user message entry"),
        }
        match &loaded.entries[1] {
            crate::session::SessionEntry::Message(m) => {
                assert!(matches!(*m.message, Message::Assistant(_)))
            }
            _ => panic!("expected assistant message entry"),
        }
    }

    #[tokio::test]
    async fn test_engine_rejects_when_stopped() {
        let store = Arc::new(InMemorySessionStore::new());
        let mgr = SessionManager::new(store);
        let engine = SessionEngine::new(SessionEngineConfig {
            session_manager: mgr,
            ..Default::default()
        });
        // Don't call start()

        let client = Arc::new(MockLlmClient {
            respond_with_tool_call: false,
        });
        let config = test_agent_config();

        let result = engine.run(client, "hello", None, &config).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_engine_abort() {
        let store = Arc::new(InMemorySessionStore::new());
        let mgr = SessionManager::new(store);
        let engine = SessionEngine::new(SessionEngineConfig {
            session_manager: mgr,
            ..Default::default()
        });
        engine.start();

        let _client = Arc::new(MockLlmClient {
            respond_with_tool_call: false,
        });
        let config = test_agent_config();

        let session = engine
            .config
            .session_manager
            .create(
                SessionConfig {
                    model: config.model.clone(),
                    system_prompt: None,
                    max_turns: None,
                    max_tokens: None,
                    temperature: None,
                    api_key: None,
                },
                None,
            )
            .await
            .unwrap();

        engine.abort_session(&session.id);
        assert_eq!(engine.active_session_count(), 0);
    }
}
