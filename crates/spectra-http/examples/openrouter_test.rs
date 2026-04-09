use spectra_http::OpenAIClient;
use spectra_core::llm::{LlmClient, LlmRequest, Model};
use futures_util::StreamExt;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let api_key = std::env::var("OPENROUTER_API_KEY").expect("OPENROUTER_API_KEY not set");
    
    let client = OpenAIClient::with_api_key(api_key)
        .with_base_url("https://openrouter.ai/api/v1/chat/completions");
    
    let model = Model::openai("google/gemma-4-26b-a4b-it:free");
    
    let request = LlmRequest {
        model,
        system_prompt: Some("You are a helpful assistant.".into()),
        messages: vec![spectra_core::messages::Message::User(
            spectra_core::messages::UserMessage::text("Say hello in one word.")
        )],
        tools: vec![],
    };

    println!("Calling OpenRouter...");
    let mut stream = client.stream(request).await?;
    println!("\nStreaming response:\n");
    while let Some(event) = stream.next().await {
        match event {
            Ok(spectra_core::llm::LlmStreamEvent::ContentDelta { delta }) => {
                match delta {
                    spectra_core::event::ContentDelta::Text { delta: text } => print!("{text}"),
                    _ => {}
                }
            }
            Ok(spectra_core::llm::LlmStreamEvent::Done { message }) => {
                println!("\n\n=== Done! ===");
                println!("Content: {:?}", message.content);
            }
            Err(e) => {
                eprintln!("Error: {:?}", e);
            }
            _ => {}
        }
    }
    Ok(())
}
