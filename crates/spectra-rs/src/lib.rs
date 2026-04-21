//! # Spectra Core
//!
//! Ultra-fast Rust core for multi-language AI agent framework.
//!
//! ## Core Concepts
//!
//! - **Agent**: Orchestrates LLM calls, tool execution, and message history
//! - **LLM Client**: Provider abstraction for LLM APIs (Anthropic, OpenAI, etc.)
//! - **Tool Registry**: Register and dispatch tools for agent use
//! - **Event Stream**: Real-time events for UI integration
//!
//! ## Extension Points
//!
//! Tool approval and other hooks are implemented as extensions. See docs/extensions.md for
//! how to implement custom hooks like `beforeToolCall` and `afterToolCall`.
//!
//! ## Example
//!
//! ```rust,no_run
//! use spectra_rs::{
//!     tool::{ToolRegistry, ToolBuilder, ToolResult},
//! };
//!
//! let registry = ToolRegistry::new();
//! registry.register(
//!     ToolBuilder::new("read")
//!         .description("Read a file")
//!         .parameters(serde_json::json!({
//!             "type": "object",
//!             "properties": {
//!                 "path": { "type": "string" }
//!             }
//!         }))
//!         .execute(|_id, _params| async move {
//!             Ok(ToolResult::success(serde_json::json!({
//!                 "content": "file contents"
//!             })))
//!         })
//!         .build()
//! );
//! ```

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
pub use extension::{Extension, ExtensionManager};
pub use llm::{
    LlmClient, LlmRequest, LlmResponse, LlmStream, LlmStreamEvent, Model, ModelConfig, ModelId,
    ModelInfo, ModelRegistry, Provider, ToolDef,
};
pub use messages::{
    AssistantMessage, Content, ImageDetail, Message, StopReason, TokenUsage, ToolCall,
    ToolResultMessage, UserMessage,
};
pub use tool::{Tool, ToolBuilder, ToolDef as ToolDefinition, ToolRegistry, ToolResult};

pub mod prelude {
    pub use super::agent::{Agent, AgentBuilder, AgentConfig};
    pub use super::error::{Result, SpectraError};
    pub use super::event::{ContentDelta, EventChannel, EventSink, StreamEvent};
    pub use super::extension::{Extension, ExtensionManager};
    pub use super::llm::{LlmClient, Model, ModelInfo, ModelRegistry, Provider};
    pub use super::messages::{AssistantMessage, Content, Message, StopReason, ToolCall, ToolResultMessage, UserMessage};
    pub use super::tool::{Tool, ToolBuilder, ToolRegistry, ToolResult};
}
