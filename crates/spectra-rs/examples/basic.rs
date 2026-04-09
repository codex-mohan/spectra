// spectra-rs example - run with: cargo run --example basic
use std::sync::Arc;
use spectra_rs::prelude::*;
use tokio::io::{AsyncWriteExt, stdout};

#[tokio::main]
async fn main() {
    println!("=== Spectra Rust SDK Example ===\n");

    let api_key = std::env::var("ANTHROPIC_API_KEY")
        .expect("ANTHROPIC_API_KEY not set");

    // Create the LLM client
    let client = Arc::new(spectra_http::AnthropicClient::with_api_key(api_key));
    println!("Created Anthropic client\n");

    // Create tool registry with a simple tool
    let registry = Arc::new(ToolRegistry::new());

    let read_tool = ToolBuilder::new("read_file")
        .description("Read contents of a file")
        .parameters(serde_json::json!({
            "type": "object",
            "properties": {
                "path": { "type": "string" }
            },
            "required": ["path"]
        }))
        .execute(|_id, params| async move {
            let path = params.get("path")
                .and_then(|p| p.as_str())
                .unwrap_or("unknown");
            Ok(ToolResult::success(serde_json::json!({
                "path": path,
                "content": format!("Contents of {}", path)
            })))
        })
        .build();

    registry.register(read_tool);
    println!("Registered tools: {}", registry.len());

    // Build the agent
    let agent = AgentBuilder::new(get_anthropic_model("claude-sonnet-4-20250514"))
        .system_prompt("You are a helpful assistant. Use tools when needed.")
        .tools(registry)
        .build(client);

    println!("\n=== Running Agent ===\n");

    // Run the agent with streaming
    let mut rx = agent.run("Read the file at /tmp/example.txt").await
        .expect("Failed to start agent");

    let mut stdout = stdout();

    while let Some(event) = rx.recv().await {
        match event {
            Ok(StreamEvent::AgentStart) => {
                println!("[Agent] Started\n");
            }
            Ok(StreamEvent::TurnStart) => {
                println!("[Turn] Started");
            }
            Ok(StreamEvent::MessageStart { .. }) => {
                print!("[Assistant] ");
                let _ = stdout.flush().await;
            }
            Ok(StreamEvent::MessageUpdate { delta }) => {
                match delta {
                    ContentDelta::Text { delta: text } => {
                        print!("{}", text);
                        let _ = stdout.flush().await;
                    }
                    ContentDelta::ToolCallStart { id, name } => {
                        print!("\n[Tool Call] {} ({})\n  ", name, id);
                        let _ = stdout.flush().await;
                    }
                    ContentDelta::ToolCallDelta { args_delta, .. } => {
                        print!("{}", args_delta);
                        let _ = stdout.flush().await;
                    }
                    ContentDelta::ToolCallEnd { .. } => {
                        println!();
                    }
                }
            }
            Ok(StreamEvent::ToolExecutionStart { tool_call }) => {
                println!("[Executing Tool] {}", tool_call.name);
            }
            Ok(StreamEvent::ToolExecutionEnd { result, .. }) => {
                println!("[Tool Result] {} (error: {})",
                    result.tool_name, result.is_error);
            }
            Ok(StreamEvent::TurnEnd { .. }) => {
                println!("\n[Turn] Ended");
            }
            Ok(StreamEvent::MessageEnd { .. }) => {
                println!();
            }
            Ok(StreamEvent::AgentEnd { messages }) => {
                println!("\n[Agent] Ended");
                println!("  Total messages: {}", messages.len());
            }
            Ok(StreamEvent::Error { message }) => {
                eprintln!("\n[Error] {}", message);
            }
            Ok(StreamEvent::ToolExecutionUpdate { .. }) => {}
            Err(e) => {
                eprintln!("\n[Error] {}", e);
            }
        }
    }

    println!("\n=== Example complete ===");
}
