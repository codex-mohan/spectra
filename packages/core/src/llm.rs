use crate::error::Result;
use crate::event::ContentDelta;
use crate::messages::{AssistantMessage, Message, StopReason, TokenUsage};
use async_trait::async_trait;
use futures_core::Stream;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::pin::Pin;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelId {
    pub provider: Provider,
    pub id: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum Provider {
    Anthropic,
    OpenAI,
    Groq,
    Custom,
}

impl Provider {
    pub fn as_str(&self) -> &str {
        match self {
            Provider::Anthropic => "anthropic",
            Provider::OpenAI => "openai",
            Provider::Groq => "groq",
            Provider::Custom => "custom",
        }
    }
}

impl std::fmt::Display for Provider {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.as_str())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Model {
    pub provider: Provider,
    pub id: String,
    pub config: ModelConfig,
}

impl Model {
    pub fn new(provider: Provider, id: impl Into<String>) -> Self {
        Self {
            provider,
            id: id.into(),
            config: ModelConfig::default(),
        }
    }

    pub fn anthropic(id: impl Into<String>) -> Self {
        Self::new(Provider::Anthropic, id)
    }

    pub fn openai(id: impl Into<String>) -> Self {
        Self::new(Provider::OpenAI, id)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelConfig {
    pub max_tokens: u32,
    pub temperature: Option<f32>,
    pub top_p: Option<f32>,
}

impl Default for ModelConfig {
    fn default() -> Self {
        Self {
            max_tokens: 4096,
            temperature: None,
            top_p: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolDef {
    pub name: String,
    pub description: String,
    pub parameters: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LlmRequest {
    pub model: Model,
    pub system_prompt: Option<String>,
    pub messages: Vec<Message>,
    pub tools: Vec<ToolDef>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LlmResponse {
    pub message: AssistantMessage,
    pub usage: TokenUsage,
    pub stop_reason: StopReason,
}

pub type LlmStream = Pin<Box<dyn Stream<Item = Result<LlmStreamEvent>> + Send>>;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum LlmStreamEvent {
    Start { partial: AssistantMessage },
    ContentDelta { delta: ContentDelta },
    ToolCallStart { id: String, name: String },
    ToolCallDelta { id: String, args_delta: String },
    ToolCallEnd { id: String },
    Done { message: AssistantMessage },
    Error { message: String },
}

#[async_trait]
pub trait LlmClient: Send + Sync {
    async fn complete(&self, request: LlmRequest) -> Result<LlmResponse>;

    async fn stream(&self, request: LlmRequest) -> Result<LlmStream>;

    fn provider(&self) -> Provider;
}
