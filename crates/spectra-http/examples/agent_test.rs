use spectra_http::OpenAIClient;
use spectra_core::llm::{LlmClient, LlmRequest, Model};
use spectra_core::event::{EventSink, StreamEvent};
use futures_util::StreamExt;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let api_key = std::env::var("OPENROUTER_API_KEY").expect("OPENROUTER_API_KEY not set");
    
    let client = OpenAIClient::with_api_key(api_key)
        .unwrap()
        .with_base_url("https://openrouter.ai/api/v1/chat/completions");
    
    let model = Model::openai("google/gemma-4-26b-a4b-it:free");
    
    let request = LlmRequest {
        model,
        system_prompt: Some("You are a helpful coding assistant.".into()),
        messages: vec![spectra_core::messages::Message::User(
            spectra_core::messages::UserMessage::text("Write a Rust function that checks if a number is prime. Keep it under 10 lines.")
        )],
        tools: vec![],
    };

    println!("Calling OpenRouter with agent loop...\n");
    let mut stream = client.stream(request).await?;
    
    while let Some(event) = stream.next().await {
        match event {
            Ok(ev) => {
                match ev {
                    spectra_core::llm::LlmStreamEvent::Start { partial } => {
                        println!("[Start] Partial: {:?}", partial.content);
                    }
                    spectra_core::llm::LlmStreamEvent::ContentDelta { delta } => {
                        match delta {
                            spectra_core::event::ContentDelta::Text { delta: text } => print!("{text}"),
                            _ => {}
                        }
                    }
                    spectra_core::llm::LlmStreamEvent::Done { message } => {
                        println!("\n\n=== Done! ===");
                        println!("Final content: {:?}", message.content);
                    }
                    _ => {}
                }
            }
            Err(e) => {
                eprintln!("\nError: {:?}", e);
            }
        }
    }
    Ok(())
}
