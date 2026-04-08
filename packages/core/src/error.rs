use miette::Diagnostic;
use thiserror::Error;

#[derive(Error, Debug, Diagnostic)]
pub enum SpectraError {
    #[error("LLM provider error: {provider} — {message}")]
    #[diagnostic(
        code(spectra::llm::provider),
        help("Check your API key and network connection for provider '{provider}'")
    )]
    LlmError {
        provider: String,
        message: String,
        #[source]
        source: Option<Box<dyn std::error::Error + Send + Sync>>,
    },

    #[error("Tool execution failed: '{name}' — {reason}")]
    #[diagnostic(
        code(spectra::tool::exec),
        help("Ensure the tool handler returns a valid ToolResult")
    )]
    ToolError {
        name: String,
        reason: String,
        #[source]
        source: Option<Box<dyn std::error::Error + Send + Sync>>,
    },

    #[error("Tool not found: '{name}'")]
    #[diagnostic(
        code(spectra::tool::not_found),
        help("Register the tool before use with ToolRegistry::register()")
    )]
    ToolNotFound { name: String },

    #[error("Schema validation failed for tool '{name}': {detail}")]
    #[diagnostic(
        code(spectra::tool::schema),
        help("The model returned arguments that do not match the tool's JSON schema")
    )]
    SchemaValidation {
        name: String,
        detail: String,
        #[source]
        source: Option<serde_json::Error>,
    },

    #[error("Stream interrupted: {reason}")]
    #[diagnostic(code(spectra::stream::interrupted))]
    StreamError { reason: String },

    #[error("Configuration error: {field} — {detail}")]
    #[diagnostic(code(spectra::config))]
    ConfigError { field: String, detail: String },

    #[error("HTTP error: {status} — {url}")]
    #[diagnostic(
        code(spectra::http),
        help("Check if the API endpoint is correct and the service is available")
    )]
    HttpError { status: u16, url: String },

    #[error("Serialization error: {0}")]
    #[diagnostic(code(spectra::serde))]
    Serialization(#[from] serde_json::Error),

    #[error("IO error: {0}")]
    #[diagnostic(code(spectra::io))]
    Io(#[from] std::io::Error),

    #[error("Tool approval denied: {reason}")]
    #[diagnostic(code(spectra::approval::denied))]
    ApprovalDenied { reason: String },

    #[error("Agent aborted")]
    #[diagnostic(code(spectra::agent::aborted))]
    Aborted,
}

pub type Result<T> = std::result::Result<T, SpectraError>;
