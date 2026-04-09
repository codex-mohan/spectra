use std::sync::Arc;

pub mod extension;
pub mod models;

pub use spectra_core::{
    agent::{Agent, AgentConfig},
    error::{Result, SpectraError},
    event::{ContentDelta, EventChannel, EventSink, StreamEvent},
    llm::{LlmClient, LlmRequest, LlmResponse, LlmStream, LlmStreamEvent, Model, ModelConfig, ModelId, Provider, ModelRegistry, ModelInfo},
    messages::{
        AssistantMessage, Content, ImageDetail, Message, StopReason, TokenUsage, ToolCall,
        ToolResultMessage, UserMessage,
    },
    tool::{Tool, ToolBuilder, ToolDef, ToolRegistry, ToolResult},
};

pub use extension::{Extension, ExtensionManager};

pub fn get_model(provider: Provider, model_id: impl Into<String>) -> Model {
    Model::new(provider, model_id)
}

pub fn get_anthropic_model(model_id: impl Into<String>) -> Model {
    Model::anthropic(model_id)
}

pub fn get_openai_model(model_id: impl Into<String>) -> Model {
    Model::openai(model_id)
}

pub struct AgentBuilder {
    model: Model,
    system_prompt: Option<String>,
    tools: Arc<ToolRegistry>,
}

impl AgentBuilder {
    pub fn new(model: Model) -> Self {
        Self {
            model,
            system_prompt: None,
            tools: Arc::new(ToolRegistry::new()),
        }
    }

    pub fn system_prompt(mut self, prompt: impl Into<String>) -> Self {
        self.system_prompt = Some(prompt.into());
        self
    }

    pub fn tools(mut self, registry: Arc<ToolRegistry>) -> Self {
        self.tools = registry;
        self
    }

    pub fn register_tool(mut self, tool: Arc<dyn Tool>) -> Self {
        Arc::make_mut(&mut self.tools).register(tool);
        self
    }

    pub fn build(self, client: Arc<dyn LlmClient>) -> Agent {
        let config = AgentConfig {
            model: self.model,
            system_prompt: self.system_prompt,
            tools: self.tools,
        };
        Agent::new(client, config)
    }
}

impl Default for AgentBuilder {
    fn default() -> Self {
        Self::new(Model::anthropic("claude-sonnet-4-20250514"))
    }
}

pub mod prelude {
    pub use super::{
        extension::Extension,
        get_anthropic_model, get_model, get_openai_model,
        Agent, AgentBuilder, AgentConfig,
        Content, ContentDelta, EventChannel, EventSink, LlmClient, LlmRequest, LlmResponse, LlmStream, LlmStreamEvent,
        Message, Model, ModelConfig, ModelInfo, ModelRegistry, Provider,
        Result, SpectraError, StopReason, StreamEvent,
        Tool, ToolBuilder, ToolDef, ToolRegistry, ToolResult, ToolResultMessage,
        UserMessage,
    };
    pub use super::models::{load_models, load_builtin_models, anthropic_models, openai_models, groq_models};
}
