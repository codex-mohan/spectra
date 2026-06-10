use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;

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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<HashMap<String, Value>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AssistantMessage {
    pub content: Vec<Content>,
    pub tool_calls: Vec<ToolCall>,
    pub stop_reason: StopReason,
    pub timestamp: DateTime<Utc>,
    pub provider: String,
    pub model: String,
    pub response_id: Option<String>,
    pub usage: TokenUsage,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<HashMap<String, Value>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Provenance {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub blocked_by: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub block_reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub transformed_by: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub retry_count: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hook_details: Option<HashMap<String, Value>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolResultMessage {
    pub tool_call_id: String,
    pub tool_name: String,
    pub content: Value,
    pub is_error: bool,
    pub timestamp: DateTime<Utc>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<HashMap<String, Value>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provenance: Option<Provenance>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Content {
    Text { text: String },
    Image { url: String, detail: ImageDetail },
    Thinking { thinking: String, signature: Option<String>, redacted: bool },
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
    pub thinking_signature: Option<String>,
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
    pub cache_read_tokens: u32,
    pub cache_write_tokens: u32,
    pub cost: Option<TokenCost>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TokenCost {
    pub input: f64,
    pub output: f64,
    pub cache_read: f64,
    pub cache_write: f64,
    pub total: f64,
}

impl UserMessage {
    pub fn new(content: Vec<Content>) -> Self {
        Self {
            content,
            timestamp: Utc::now(),
            metadata: None,
        }
    }

    pub fn text(text: impl Into<String>) -> Self {
        Self::new(vec![Content::Text { text: text.into() }])
    }

    pub fn with_metadata(mut self, metadata: HashMap<String, Value>) -> Self {
        self.metadata = Some(metadata);
        self
    }
}

impl AssistantMessage {
    pub fn new(
        content: Vec<Content>,
        tool_calls: Vec<ToolCall>,
        stop_reason: StopReason,
    ) -> Self {
        Self {
            content,
            tool_calls,
            stop_reason,
            timestamp: Utc::now(),
            provider: String::new(),
            model: String::new(),
            response_id: None,
            usage: TokenUsage::default(),
            error_message: None,
            metadata: None,
        }
    }

    pub fn with_full_metadata(
        content: Vec<Content>,
        tool_calls: Vec<ToolCall>,
        stop_reason: StopReason,
        provider: impl Into<String>,
        model: impl Into<String>,
        response_id: Option<String>,
        usage: TokenUsage,
    ) -> Self {
        Self {
            content,
            tool_calls,
            stop_reason,
            timestamp: Utc::now(),
            provider: provider.into(),
            model: model.into(),
            response_id,
            usage,
            error_message: None,
            metadata: None,
        }
    }

    pub fn with_error(mut self, error_message: impl Into<String>) -> Self {
        self.error_message = Some(error_message.into());
        self
    }

    pub fn with_metadata(mut self, metadata: HashMap<String, Value>) -> Self {
        self.metadata = Some(metadata);
        self
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
            details: None,
            metadata: None,
            provenance: None,
        }
    }

    pub fn error(tool_call_id: String, tool_name: String, error_message: String) -> Self {
        Self {
            tool_call_id,
            tool_name,
            content: serde_json::json!({ "error": error_message }),
            is_error: true,
            timestamp: Utc::now(),
            details: None,
            metadata: None,
            provenance: None,
        }
    }

    pub fn with_details(mut self, details: Value) -> Self {
        self.details = Some(details);
        self
    }

    pub fn with_metadata(mut self, metadata: HashMap<String, Value>) -> Self {
        self.metadata = Some(metadata);
        self
    }

    pub fn with_provenance(mut self, provenance: Provenance) -> Self {
        self.provenance = Some(provenance);
        self
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_user_message_text() {
        let msg = UserMessage::text("Hello, world!");
        assert_eq!(msg.content.len(), 1);
        match &msg.content[0] {
            Content::Text { text } => assert_eq!(text, "Hello, world!"),
            _ => panic!("Expected text content"),
        }
    }

    #[test]
    fn test_user_message_with_metadata() {
        let mut meta = std::collections::HashMap::new();
        meta.insert("source".to_string(), json!("test"));
        let msg = UserMessage::text("hi").with_metadata(meta);
        assert!(msg.metadata.is_some());
        assert_eq!(msg.metadata.unwrap().get("source").unwrap(), "test");
    }

    #[test]
    fn test_assistant_message_new() {
        let msg = AssistantMessage::new(
            vec![Content::Text {
                text: "response".to_string(),
            }],
            vec![],
            StopReason::EndOfTurn,
        );
        assert_eq!(msg.stop_reason, StopReason::EndOfTurn);
        assert_eq!(msg.tool_calls.len(), 0);
    }

    #[test]
    fn test_assistant_message_full_metadata() {
        let usage = TokenUsage {
            input_tokens: 10,
            output_tokens: 5,
            cache_read_tokens: 0,
            cache_write_tokens: 0,
            cost: None,
        };
        let msg = AssistantMessage::with_full_metadata(
            vec![],
            vec![],
            StopReason::ToolCalls,
            "anthropic",
            "claude-sonnet",
            Some("resp-123".to_string()),
            usage,
        );
        assert_eq!(msg.provider, "anthropic");
        assert_eq!(msg.model, "claude-sonnet");
        assert_eq!(msg.response_id, Some("resp-123".to_string()));
        assert_eq!(msg.usage.input_tokens, 10);
    }

    #[test]
    fn test_assistant_message_with_error() {
        let msg = AssistantMessage::new(vec![], vec![], StopReason::Error)
            .with_error("Something went wrong");
        assert_eq!(msg.error_message, Some("Something went wrong".to_string()));
    }

    #[test]
    fn test_tool_result_success() {
        let msg = ToolResultMessage::success("tc-1".to_string(), "get_weather".to_string(), json!({"temp": 72}));
        assert_eq!(msg.tool_call_id, "tc-1");
        assert_eq!(msg.tool_name, "get_weather");
        assert!(!msg.is_error);
        assert_eq!(msg.content, json!({"temp": 72}));
    }

    #[test]
    fn test_tool_result_error() {
        let msg = ToolResultMessage::error("tc-2".to_string(), "bad_tool".to_string(), "Permission denied".to_string());
        assert_eq!(msg.tool_call_id, "tc-2");
        assert!(msg.is_error);
        assert_eq!(msg.content, json!({"error": "Permission denied"}));
    }

    #[test]
    fn test_tool_result_with_provenance() {
        let prov = Provenance {
            blocked_by: Some("security_check".to_string()),
            block_reason: Some("Blocked for safety".to_string()),
            transformed_by: None,
            retry_count: None,
            hook_details: None,
        };
        let msg = ToolResultMessage::success("tc-3".to_string(), "tool".to_string(), json!({}))
            .with_provenance(prov);
        assert!(msg.provenance.is_some());
        let p = msg.provenance.unwrap();
        assert_eq!(p.blocked_by, Some("security_check".to_string()));
        assert_eq!(p.block_reason, Some("Blocked for safety".to_string()));
    }

    #[test]
    fn test_stop_reason_display() {
        assert_eq!(StopReason::EndOfTurn.to_string(), "end_turn");
        assert_eq!(StopReason::ToolCalls.to_string(), "tool_calls");
        assert_eq!(StopReason::MaxTokens.to_string(), "max_tokens");
        assert_eq!(StopReason::Error.to_string(), "error");
        assert_eq!(StopReason::Aborted.to_string(), "aborted");
    }

    #[test]
    fn test_tool_result_chaining() {
        let msg = ToolResultMessage::success("tc".to_string(), "t".to_string(), json!({}))
            .with_details(json!({"elapsed_ms": 42}))
            .with_metadata(std::collections::HashMap::new());
        assert_eq!(msg.details, Some(json!({"elapsed_ms": 42})));
    }

    #[test]
    fn test_message_enum_serialization() {
        let msg = Message::User(UserMessage::text("hello"));
        let json_str = serde_json::to_string(&msg).unwrap();
        assert!(json_str.contains("hello"));
        assert!(json_str.contains("user"));
    }

    #[test]
    fn test_tool_call_creation() {
        let tc = ToolCall {
            id: "tc-1".to_string(),
            name: "search".to_string(),
            arguments: json!({"query": "rust"}),
            thinking_signature: None,
        };
        assert_eq!(tc.id, "tc-1");
        assert_eq!(tc.name, "search");
        assert_eq!(tc.arguments, json!({"query": "rust"}));
    }
}
