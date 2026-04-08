// spectra-rs example - run with: cargo run --example basic
use std::sync::Arc;
use spectra_rs::prelude::*;

#[tokio::main]
async fn main() {
    println!("=== Spectra Rust SDK Example ===\n");

    // Load models from TOML (embedded in crate)
    let models = load_builtin_models()
        .expect("Failed to load models");

    println!("Loaded {} models:", models.models.len());
    for model in &models.models {
        println!("  - {} ({})", model.id, model.provider);
    }

    println!("\n=== Available Anthropic models ===");
    let anthropic = models.by_provider(Provider::Anthropic);
    for m in anthropic {
        println!("  - {}: {}", m.id, m.description.as_deref().unwrap_or("N/A"));
    }

    // Create a model
    let model = get_anthropic_model("claude-sonnet-4-5");
    println!("\n=== Created model ===");
    println!("  Provider: {}", model.provider);
    println!("  ID: {}", model.id);

    // Create tool registry
    let registry = Arc::new(ToolRegistry::new());
    println!("\n=== Tool Registry ===");
    println!("  Tools registered: {}", registry.len());

    // Create agent config (without actual LLM client for demo)
    let config = AgentConfig {
        model,
        system_prompt: Some("You are a helpful assistant.".to_string()),
        tools: registry,
    };

    println!("\n=== Agent Config ===");
    println!("  Model: {}", config.model.id);
    println!("  System prompt: {}", config.system_prompt.as_deref().unwrap_or("None"));

    // Extension example
    struct LoggingExtension;
    impl Extension for LoggingExtension {
        fn on_agent_start(&self) {
            println!("[Extension] Agent started!");
        }
        fn on_agent_end(&self) {
            println!("[Extension] Agent ended!");
        }
    }

    println!("\n=== Extension ===");
    println!("  LoggingExtension ready");

    println!("\n=== Example complete ===");
    println!("Note: Full agent loop requires implementing LlmClient trait with actual API calls.");
}
