pub mod anthropic;
pub mod groq;
pub mod openai;
#[cfg(test)]
mod test;

pub use anthropic::AnthropicClient;
pub use groq::GroqClient;
pub use openai::OpenAIClient;

pub mod prelude {
    pub use super::{AnthropicClient, GroqClient, OpenAIClient};
    pub use spectra_rs::llm::{LlmClient, LlmRequest, LlmResponse, LlmStream, LlmStreamEvent, Model};
}