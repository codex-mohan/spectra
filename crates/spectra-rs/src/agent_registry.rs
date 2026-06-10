use std::collections::HashMap;
use std::sync::Arc;

use crate::agent::AgentBuilder;
use crate::llm::LlmClient;

#[derive(Debug, Clone)]
pub struct DelegationResult {
    pub agent_type: String,
    pub success: bool,
    pub output: String,
    pub error: Option<String>,
}

#[derive(Debug, Clone)]
pub struct TaskConfig {
    pub agent_type: String,
    pub task: String,
}

struct StoredAgent {
    client: Arc<dyn LlmClient>,
    builder: AgentBuilder,
}

pub struct AgentRegistry {
    agents: HashMap<String, StoredAgent>,
}

impl AgentRegistry {
    pub fn new() -> Self {
        Self {
            agents: HashMap::new(),
        }
    }

    pub fn register(
        &mut self,
        name: impl Into<String>,
        client: Arc<dyn LlmClient>,
        builder: AgentBuilder,
    ) {
        self.agents.insert(
            name.into(),
            StoredAgent { client, builder },
        );
    }

    pub async fn delegate(&self, agent_type: &str, task: &str) -> DelegationResult {
        let stored = match self.agents.get(agent_type) {
            Some(s) => s,
            None => {
                return DelegationResult {
                    agent_type: agent_type.to_string(),
                    success: false,
                    output: String::new(),
                    error: Some(format!("Unknown agent type: {agent_type}")),
                };
            }
        };

        let agent = stored.builder.clone().build(stored.client.clone());

        let result = agent.run(task).await;
        let (_rx, _channel, _handle) = match result {
            Ok(handle) => handle,
            Err(e) => {
                return DelegationResult {
                    agent_type: agent_type.to_string(),
                    success: false,
                    output: String::new(),
                    error: Some(e.to_string()),
                };
            }
        };

        DelegationResult {
            agent_type: agent_type.to_string(),
            success: true,
            output: String::new(),
            error: None,
        }
    }

    pub async fn execute_parallel(&self, tasks: &[TaskConfig]) -> Vec<DelegationResult> {
        futures_util::future::join_all(tasks.iter().map(|t| self.delegate(&t.agent_type, &t.task)))
            .await
    }

    pub fn contains(&self, agent_type: &str) -> bool {
        self.agents.contains_key(agent_type)
    }

    pub fn len(&self) -> usize {
        self.agents.len()
    }

    pub fn is_empty(&self) -> bool {
        self.agents.is_empty()
    }
}

impl Default for AgentRegistry {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent::AgentBuilder;
    use crate::llm::{LlmClient, LlmRequest, LlmResponse, LlmStream, LlmStreamEvent, Model, Provider};
    use crate::messages::{AssistantMessage, Content, StopReason};
    use async_trait::async_trait;

    struct MockLlmClient;

    #[async_trait]
    impl LlmClient for MockLlmClient {
        fn provider(&self) -> Provider {
            Provider::Custom
        }

        async fn complete(&self, _request: LlmRequest) -> crate::error::Result<LlmResponse> {
            Ok(LlmResponse {
                message: AssistantMessage::new(vec![], vec![], StopReason::EndOfTurn),
                usage: Default::default(),
                stop_reason: StopReason::EndOfTurn,
            })
        }

        async fn stream(&self, _request: LlmRequest) -> crate::error::Result<LlmStream> {
            let (tx, rx) = tokio::sync::mpsc::channel(1);
            let _ = tx.send(Ok(LlmStreamEvent::Done {
                message: AssistantMessage::new(
                    vec![Content::Text { text: "mock".into() }],
                    vec![],
                    StopReason::EndOfTurn,
                ),
            })).await;
            Ok(Box::pin(tokio_stream::wrappers::ReceiverStream::new(rx)))
        }
    }

    #[test]
    fn test_registry_starts_empty() {
        let registry = AgentRegistry::new();
        assert!(registry.is_empty());
        assert_eq!(registry.len(), 0);
    }

    #[test]
    fn test_register_and_contains() {
        let mut registry = AgentRegistry::new();
        let client = Arc::new(MockLlmClient);
        let builder = AgentBuilder::new(Model::new(Provider::Custom, "test-model"));

        registry.register("builder", client, builder);
        assert!(registry.contains("builder"));
        assert!(!registry.contains("unknown"));
        assert_eq!(registry.len(), 1);
        assert!(!registry.is_empty());
    }

    #[test]
    fn test_register_multiple_agents() {
        let mut registry = AgentRegistry::new();
        let client = Arc::new(MockLlmClient);

        registry.register("agent_a", client.clone(), AgentBuilder::new(Model::new(Provider::Custom, "a")));
        registry.register("agent_b", client.clone(), AgentBuilder::new(Model::new(Provider::Custom, "b")));
        registry.register("agent_c", client, AgentBuilder::new(Model::new(Provider::Custom, "c")));

        assert_eq!(registry.len(), 3);
        assert!(registry.contains("agent_a"));
        assert!(registry.contains("agent_b"));
        assert!(registry.contains("agent_c"));
    }

    #[tokio::test]
    async fn test_delegate_to_unknown_agent() {
        let registry = AgentRegistry::new();
        let result = registry.delegate("nonexistent", "do something").await;
        assert!(!result.success);
        assert!(result.error.is_some());
        assert!(result.error.unwrap().contains("Unknown agent type"));
    }

    #[tokio::test]
    async fn test_execute_parallel_with_mixed_results() {
        let mut registry = AgentRegistry::new();
        let client = Arc::new(MockLlmClient);
        let builder = AgentBuilder::new(Model::new(Provider::Custom, "ok-model"));
        registry.register("ok_agent", client.clone(), builder);

        let tasks = vec![
            TaskConfig { agent_type: "ok_agent".into(), task: "do something".into() },
            TaskConfig { agent_type: "bad_agent".into(), task: "fail".into() },
        ];

        let results = registry.execute_parallel(&tasks).await;
        assert_eq!(results.len(), 2);
        assert!(results[0].success);
        assert!(!results[1].success);
        assert!(results[1].error.as_ref().unwrap().contains("Unknown"));
    }

    #[test]
    fn test_default_registry() {
        let registry = AgentRegistry::default();
        assert!(registry.is_empty());
    }
}
