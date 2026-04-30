use spectra_http::OpenAIClient;
use spectra_rs::llm::{LlmClient, LlmRequest, Model};
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
        messages: vec![spectra_rs::messages::Message::User(
            spectra_rs::messages::UserMessage::text("Write a Rust function that checks if a number is prime. Keep it under 10 lines.")
        )],
        tools: vec![],
    };

    println!("Calling OpenRouter with agent loop...\n");
    let mut stream = client.stream(request).await?;
    
    while let Some(event) = stream.next().await {
        match event {
            Ok(ev) => {
                match ev {
                    spectra_rs::llm::LlmStreamEvent::Start { partial } => {
                        println!("[Start] Partial: {:?}", partial.content);
                    }
                    spectra_rs::llm::LlmStreamEvent::ContentDelta { delta: spectra_rs::event::ContentDelta::Text { delta: text } } => {
                        print!("{text}");
                    }
                    spectra_rs::llm::LlmStreamEvent::ContentDelta { .. } => {}
                    spectra_rs::llm::LlmStreamEvent::Done { message } => {
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
