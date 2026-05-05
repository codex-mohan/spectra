pub mod agent;
pub mod error;
pub mod event;
pub mod extension;
pub mod llm;
pub mod messages;
pub mod tool;

pub use agent::{Agent, AgentBuilder, AgentConfig, AgentHandle, ToolExecutionMode};
pub use error::{Result, SpectraError};
pub use event::{ContentDelta, EventChannel, EventSink, StreamEvent};
pub use extension::{AfterToolCallAction, BeforeToolCallAction, Extension, ExtensionManager};
pub use llm::{
    LlmClient, LlmRequest, LlmResponse, LlmStream, LlmStreamEvent, Model, ModelConfig, ModelId,
    ModelInfo, ModelRegistry, Provider, ReasoningEffort, ToolChoice, ToolDef,
};
pub use messages::{
    AssistantMessage, Content, ImageDetail, Message, StopReason, TokenCost, TokenUsage, ToolCall,
    ToolResultMessage, UserMessage,
};
pub use tool::{Tool, ToolBuilder, ToolContext, ToolDef as ToolDefinition, ToolRegistry, ToolResult};

pub mod prelude {
    pub use super::agent::{Agent, AgentBuilder, AgentConfig};
    pub use super::error::{Result, SpectraError};
    pub use super::event::{ContentDelta, EventChannel, EventSink, StreamEvent};
    pub use super::extension::{Extension, ExtensionManager};
    pub use super::llm::{LlmClient, Model, ModelInfo, ModelRegistry, Provider};
    pub use super::messages::{
        AssistantMessage, Content, Message, StopReason, ToolCall, ToolResultMessage, UserMessage,
    };
    pub use super::tool::{Tool, ToolBuilder, ToolContext, ToolRegistry, ToolResult};
}
