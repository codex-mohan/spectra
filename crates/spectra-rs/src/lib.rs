pub mod agent;
pub mod agent_registry;
pub mod circuit_breaker;
pub mod error;
pub mod event;
pub mod extension;
pub mod health_probe;
pub mod llm;
pub mod messages;
pub mod rate_limiter;
pub mod tool;
pub mod worker_pool;

pub use agent::{Agent, AgentBuilder, AgentConfig, AgentHandle, ToolExecutionMode};
pub use error::{Result, SpectraError};
pub use event::{ContentDelta, EventChannel, EventSink, StreamEvent};
pub use extension::{AfterToolCallAction, BeforeToolCallAction, Extension, ExtensionManager};
pub use llm::{
    LlmClient, LlmRequest, LlmResponse, LlmStream, LlmStreamEvent, Model, ModelConfig, ModelId,
    ModelInfo, ModelRegistry, Provider, ReasoningEffort, ToolChoice, ToolDef,
};
pub use messages::{
    AssistantMessage, Content, ImageDetail, Message, Provenance, StopReason, TokenCost,
    TokenUsage, ToolCall, ToolResultMessage, UserMessage,
};
pub use agent_registry::{AgentRegistry, DelegationResult, TaskConfig};
pub use circuit_breaker::{CircuitBreaker, CircuitBreakerConfig, CircuitBreakerError, CircuitState};
pub use health_probe::{HealthCheckResult, HealthProbe, HealthReport, HealthStatus};
pub use rate_limiter::{LocalRateLimiter, RateLimitResult, RateLimiter};
pub use tool::{Tool, ToolBuilder, ToolContext, ToolDef as ToolDefinition, ToolRegistry, ToolResult};
pub use worker_pool::{SequentialWorkerPool, WorkerJob, WorkerResult};

pub mod prelude {
    pub use super::agent::{Agent, AgentBuilder, AgentConfig};
    pub use super::agent_registry::AgentRegistry;
    pub use super::circuit_breaker::{CircuitBreaker, CircuitBreakerConfig, CircuitBreakerError, CircuitState};
    pub use super::error::{Result, SpectraError};
    pub use super::event::{ContentDelta, EventChannel, EventSink, StreamEvent};
    pub use super::extension::{Extension, ExtensionManager};
    pub use super::health_probe::HealthProbe;
    pub use super::llm::{LlmClient, Model, ModelInfo, ModelRegistry, Provider};
    pub use super::messages::{
        AssistantMessage, Content, Message, StopReason, ToolCall, ToolResultMessage, UserMessage,
    };
    pub use super::rate_limiter::{LocalRateLimiter, RateLimitResult, RateLimiter};
    pub use super::tool::{Tool, ToolBuilder, ToolContext, ToolRegistry, ToolResult};
    pub use super::worker_pool::SequentialWorkerPool;
}
