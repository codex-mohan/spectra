pub mod anthropic;
pub mod openai;
#[cfg(test)]
mod test;

pub use anthropic::AnthropicClient;
pub use openai::OpenAIClient;

pub mod prelude {
    pub use super::{AnthropicClient, OpenAIClient};
    pub use spectra_core::llm::{LlmClient, LlmRequest, LlmResponse, LlmStream, LlmStreamEvent, Model};
}