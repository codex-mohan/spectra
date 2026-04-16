use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "role", rename_all = "snake_case")]
pub enum Message {
    User(UserMessage),
    Assistant(AssistantMessage),
    ToolResult(ToolResultMessage),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserMessage {
    pub content: Vec<Content>,
    pub timestamp: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AssistantMessage {
    pub content: Vec<Content>,
    pub tool_calls: Vec<ToolCall>,
    pub stop_reason: StopReason,
    pub timestamp: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolResultMessage {
    pub tool_call_id: String,
    pub tool_name: String,
    pub content: Value,
    pub is_error: bool,
    pub timestamp: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Content {
    Text { text: String },
    Image { url: String, detail: ImageDetail },
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
pub enum ImageDetail {
    #[default]
    Low,
    High,
    Auto,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolCall {
    pub id: String,
    pub name: String,
    pub arguments: Value,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
pub enum StopReason {
    #[default]
    EndOfTurn,
    ToolCalls,
    MaxTokens,
    Error,
    Aborted,
}

impl std::fmt::Display for StopReason {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            StopReason::EndOfTurn => write!(f, "end_turn"),
            StopReason::ToolCalls => write!(f, "tool_calls"),
            StopReason::MaxTokens => write!(f, "max_tokens"),
            StopReason::Error => write!(f, "error"),
            StopReason::Aborted => write!(f, "aborted"),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct TokenUsage {
    pub input_tokens: u32,
    pub output_tokens: u32,
    pub cache_read_tokens: Option<u32>,
    pub cache_write_tokens: Option<u32>,
}

impl UserMessage {
    pub fn new(content: Vec<Content>) -> Self {
        Self {
            content,
            timestamp: Utc::now(),
        }
    }

    pub fn text(text: impl Into<String>) -> Self {
        Self::new(vec![Content::Text { text: text.into() }])
    }
}

impl AssistantMessage {
    pub fn new(content: Vec<Content>, tool_calls: Vec<ToolCall>, stop_reason: StopReason) -> Self {
        Self {
            content,
            tool_calls,
            stop_reason,
            timestamp: Utc::now(),
        }
    }
}

impl ToolResultMessage {
    pub fn success(tool_call_id: String, tool_name: String, content: Value) -> Self {
        Self {
            tool_call_id,
            tool_name,
            content,
            is_error: false,
            timestamp: Utc::now(),
        }
    }

    pub fn error(tool_call_id: String, tool_name: String, error_message: String) -> Self {
        Self {
            tool_call_id,
            tool_name,
            content: serde_json::json!({ "error": error_message }),
            is_error: true,
            timestamp: Utc::now(),
        }
    }
}
