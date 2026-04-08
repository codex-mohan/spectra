use crate::error::Result;
use crate::event::{EventChannel, StreamEvent};
use crate::llm::{LlmClient, Model};
use crate::messages::{AssistantMessage, Message, StopReason, UserMessage};
use crate::tool::ToolRegistry;
use std::sync::Arc;
use tokio::sync::mpsc;

pub struct AgentConfig {
    pub model: Model,
    pub system_prompt: Option<String>,
    pub tools: Arc<ToolRegistry>,
}

impl Default for AgentConfig {
    fn default() -> Self {
        Self {
            model: Model::anthropic("claude-sonnet-4-20250514"),
            system_prompt: None,
            tools: Arc::new(ToolRegistry::new()),
        }
    }
}

pub struct Agent {
    #[allow(dead_code)]
    client: Arc<dyn LlmClient>,
    config: AgentConfig,
}

impl Agent {
    pub fn new(client: Arc<dyn LlmClient>, config: AgentConfig) -> Self {
        Self { client, config }
    }

    pub async fn run(
        &self,
        user_input: impl Into<String>,
    ) -> Result<mpsc::Receiver<Result<StreamEvent>>> {
        let (tx, rx) = mpsc::channel(256);
        let channel = EventChannel::new();

        let messages = vec![Message::User(UserMessage::text(user_input))];

        let tx_for_error = tx.clone();
        let channel_clone = channel.clone();

        tokio::spawn(async move {
            if let Err(e) = run_loop(
                Arc::new(messages),
                &channel_clone,
                tx,
            ).await {
                let _ = tx_for_error.send(Err(e)).await;
            }
        });

        Ok(rx)
    }

    pub fn config(&self) -> &AgentConfig {
        &self.config
    }
}

async fn run_loop(
    messages: Arc<Vec<Message>>,
    channel: &EventChannel,
    _tx: mpsc::Sender<Result<StreamEvent>>,
) -> Result<()> {
    channel.emit(StreamEvent::AgentStart)?;

    let user_messages: Vec<&UserMessage> = messages
        .iter()
        .filter_map(|m| match m {
            Message::User(u) => Some(u),
            _ => None,
        })
        .collect();

    channel.emit(StreamEvent::TurnStart)?;

    for msg in user_messages {
        channel.emit(StreamEvent::MessageStart {
            message: AssistantMessage::new(
                msg.content.clone(),
                Vec::new(),
                StopReason::EndOfTurn,
            ),
        })?;
    }

    channel.emit(StreamEvent::AgentEnd { messages: Vec::new() })?;
    Ok(())
}
