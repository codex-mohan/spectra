use crate::messages::{AssistantMessage, ToolCall, ToolResultMessage};
use crate::error::Result;
use crate::messages::Message;
use tokio::sync::broadcast;

#[derive(Debug, Clone)]
pub enum StreamEvent {
    AgentStart,
    TurnStart,
    MessageStart { message: Message },
    MessageUpdate { delta: ContentDelta },
    MessageEnd { message: Message },
    TurnEnd { tool_results: Vec<ToolResultMessage> },
    ToolExecutionStart { tool_call: ToolCall },
    ToolExecutionUpdate { partial: serde_json::Value },
    ToolExecutionEnd { result: ToolResultMessage, is_error: bool },
    AgentEnd { messages: Vec<AssistantMessage> },
    Error { message: String },
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub enum ContentDelta {
    Text { delta: String },
    ToolCallStart { id: String, name: String },
    ToolCallDelta { id: String, args_delta: String },
    ToolCallEnd { id: String },
}

pub struct EventChannel {
    sender: broadcast::Sender<StreamEvent>,
}

impl EventChannel {
    pub fn new() -> Self {
        let (sender, _) = broadcast::channel(256);
        Self { sender }
    }

    pub fn subscribe(&self) -> broadcast::Receiver<StreamEvent> {
        self.sender.subscribe()
    }

    pub fn emit(&self, event: StreamEvent) -> Result<()> {
        self.sender
            .send(event)
            .map_err(|_| crate::error::SpectraError::StreamError {
                reason: "No active receivers".to_string(),
            })?;
        Ok(())
    }

    pub fn close(&self) {
        let _ = self.emit(StreamEvent::AgentEnd {
            messages: Vec::new(),
        });
    }
}

impl Default for EventChannel {
    fn default() -> Self {
        Self::new()
    }
}

impl Clone for EventChannel {
    fn clone(&self) -> Self {
        Self {
            sender: self.sender.clone(),
        }
    }
}

pub trait EventSink: Send + Sync {
    fn emit(&self, event: StreamEvent) -> Result<()>;
}

impl EventSink for EventChannel {
    fn emit(&self, event: StreamEvent) -> Result<()> {
        EventChannel::emit(self, event)
    }
}
