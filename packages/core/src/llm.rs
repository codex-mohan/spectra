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
    pub fn as_str(&self) -> &'static str {
        match self {
            Provider::Anthropic => "anthropic",
            Provider::OpenAI => "openai",
            Provider::Groq => "groq",
            Provider::Custom => "custom",
        }
    }

    #[allow(clippy::should_implement_trait)]
    pub fn parse(s: &str) -> Option<Self> {
        match s.to_lowercase().as_str() {
            "anthropic" => Some(Provider::Anthropic),
            "openai" => Some(Provider::OpenAI),
            "groq" => Some(Provider::Groq),
            _ => None,
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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelInfo {
    pub id: String,
    pub provider: Provider,
    pub description: Option<String>,
    pub context_window: Option<u32>,
    pub supports_vision: bool,
    pub supports_tools: bool,
}

#[derive(Debug, Clone, Deserialize)]
struct RawModelInfo {
    id: String,
    provider: String,
    description: Option<String>,
    context_window: Option<u32>,
    #[serde(default)]
    supports_vision: bool,
    #[serde(default)]
    supports_tools: bool,
}

impl RawModelInfo {
    fn into_model_info(self) -> Option<ModelInfo> {
        Some(ModelInfo {
            id: self.id,
            provider: Provider::parse(&self.provider)?,
            description: self.description,
            context_window: self.context_window,
            supports_vision: self.supports_vision,
            supports_tools: self.supports_tools,
        })
    }
}

#[derive(Debug, Clone, Deserialize)]
struct RawModelRegistry {
    models: Vec<RawModelInfo>,
}

#[derive(Debug, Clone)]
pub struct ModelRegistry {
    pub models: Vec<ModelInfo>,
}

impl ModelRegistry {
    pub fn new() -> Self {
        Self { models: Vec::new() }
    }

    pub fn from_json(json: &str) -> Result<Self> {
        let raw: RawModelRegistry = serde_json::from_str(json)?;
        
        let models: Vec<ModelInfo> = raw.models
            .into_iter()
            .filter_map(|m| m.into_model_info())
            .collect();
        
        Ok(Self { models })
    }

    pub fn from_toml(toml_str: &str) -> Result<Self> {
        let raw: RawModelRegistry = match toml::from_str(toml_str) {
            Ok(r) => r,
            Err(e) => return Err(crate::error::SpectraError::Io(
                std::io::Error::new(std::io::ErrorKind::InvalidData, e.to_string())
            )),
        };
        
        let models: Vec<ModelInfo> = raw.models
            .into_iter()
            .filter_map(|m| m.into_model_info())
            .collect();
        
        Ok(Self { models })
    }

    pub fn get(&self, id: &str) -> Option<&ModelInfo> {
        self.models.iter().find(|m| m.id == id)
    }

    pub fn by_provider(&self, provider: Provider) -> Vec<&ModelInfo> {
        self.models.iter().filter(|m| m.provider == provider).collect()
    }

    pub fn load_from_file(path: &std::path::Path) -> Result<Self> {
        let content = std::fs::read_to_string(path)?;
        
        let ext = path.extension()
            .and_then(|e| e.to_str())
            .unwrap_or("json");
        
        match ext.to_lowercase().as_str() {
            "toml" => Self::from_toml(&content),
            _ => Self::from_json(&content),
        }
    }
}

impl Default for ModelRegistry {
    fn default() -> Self {
        Self::new()
    }
}

pub fn load_models_from_file(path: &str) -> Result<ModelRegistry> {
    ModelRegistry::load_from_file(std::path::Path::new(path))
}
