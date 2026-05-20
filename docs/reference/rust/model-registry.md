# ModelRegistry Reference

Model configuration, provider enumeration, and model registry for the Rust SDK.

## Overview

The Rust SDK does **not** embed a static list of models at compile time. Instead, `ModelRegistry` is a runtime loader that reads model configurations from external JSON or TOML files. This keeps the compiled binary small and allows users to add or update models without recompiling.

## Model

```rust
pub struct Model {
    pub provider: Provider,
    pub id: String,
    pub config: ModelConfig,
}

impl Model {
    pub fn new(provider: Provider, id: impl Into<String>) -> Self;
    pub fn anthropic(id: impl Into<String>) -> Self;
    pub fn openai(id: impl Into<String>) -> Self;
}
```

`Model` is a lightweight struct that pairs a `Provider` with a model ID and optional configuration. Convenience constructors `Model::anthropic()` and `Model::openai()` set the provider automatically.

## ModelConfig

```rust
pub struct ModelConfig {
    pub max_tokens: u32,
    pub temperature: Option<f32>,
    pub top_p: Option<f32>,
}
```

Default: `max_tokens: 4096`, `temperature: None`, `top_p: None`.

## Provider Enum

```rust
pub enum Provider {
    Anthropic,
    OpenAI,
    Groq,
    Custom,
}

impl Provider {
    pub fn as_str(&self) -> &'static str;
    pub fn parse(s: &str) -> Option<Self>;
}
```

The `Provider` enum has four variants. `Provider::parse()` accepts `"anthropic"`, `"openai"`, and `"groq"` (case-insensitive). Any other string returns `None` — use `Provider::Custom` for unrecognized providers.

## ModelInfo

```rust
pub struct ModelInfo {
    pub id: String,
    pub provider: Provider,
    pub description: Option<String>,
    pub context_window: Option<u32>,
    pub supports_vision: bool,
    pub supports_tools: bool,
}
```

`ModelInfo` holds metadata about a model. It is populated from external config files, not embedded in the SDK.

## ModelRegistry

```rust
pub struct ModelRegistry {
    pub models: Vec<ModelInfo>,
}

impl ModelRegistry {
    pub fn new() -> Self;
    pub fn from_json(json: &str) -> Result<Self>;
    pub fn from_toml(toml_str: &str) -> Result<Self>;
    pub fn load_from_file(path: &std::path::Path) -> Result<Self>;
    pub fn get(&self, id: &str) -> Option<&ModelInfo>;
    pub fn by_provider(&self, provider: Provider) -> Vec<&ModelInfo>;
}

// Convenience function
pub fn load_models_from_file(path: &str) -> Result<ModelRegistry>;
```

`ModelRegistry::default()` returns an empty registry. Models must be loaded explicitly.

### Loading from a File

```rust
use spectra_rs::{ModelRegistry, load_models_from_file, Provider};

// JSON format
let registry = load_models_from_file("models.json")?;

// TOML format (extension determines parser)
let registry = load_models_from_file("models.toml")?;

// Query models
let claude = registry.get("claude-sonnet-4-20250514");
let all_anthropic = registry.by_provider(Provider::Anthropic);
```

### Loading from a String

```rust
use spectra_rs::ModelRegistry;

let json = r#"
{
  "models": [
    {
      "id": "claude-sonnet-4-20250514",
      "provider": "anthropic",
      "description": "Claude Sonnet 4",
      "context_window": 200000,
      "supports_vision": true,
      "supports_tools": true
    },
    {
      "id": "gpt-4o",
      "provider": "openai",
      "context_window": 128000,
      "supports_vision": true,
      "supports_tools": true
    }
  ]
}
"#;

let registry = ModelRegistry::from_json(json)?;
```

### JSON Config Format

```json
{
  "models": [
    {
      "id": "claude-sonnet-4-20250514",
      "provider": "anthropic",
      "description": "Claude Sonnet 4",
      "context_window": 200000,
      "supports_vision": true,
      "supports_tools": true
    }
  ]
}
```

### TOML Config Format

```toml
[[models]]
id = "claude-sonnet-4-20250514"
provider = "anthropic"
description = "Claude Sonnet 4"
context_window = 200000
supports_vision = true
supports_tools = true

[[models]]
id = "gpt-4o"
provider = "openai"
context_window = 128000
supports_vision = true
supports_tools = true
```

## Provider String Mapping

When loading from JSON/TOML, the `provider` field is a string that maps to the `Provider` enum:

| String | Enum Variant |
|--------|-------------|
| `"anthropic"` | `Provider::Anthropic` |
| `"openai"` | `Provider::OpenAI` |
| `"groq"` | `Provider::Groq` |
| anything else | `None` (filtered out) |

For providers not in the enum (e.g., `"mistral"`, `"togetherai"`), use `Provider::Custom` in your code and set the provider string in the config file — though these entries will be filtered out during parsing since `Provider::parse()` returns `None` for unrecognized strings. To use custom providers, construct `Model` directly with `Provider::Custom`.

## Relationship to TypeScript SDK

The TypeScript SDK has a fundamentally different approach: it auto-generates a static model list at **build time** (see [TypeScript Model Registry](/typescript/providers#model-registry)). The Rust SDK intentionally avoids this — models are loaded at runtime from config files, giving users full control without recompilation.

## Related

- [Rust Providers Guide](/rust/providers) — Client implementations
- [LlmClient Reference](/reference/rust/llm-client) — Communication trait
- [Agent Builder](/reference/rust/agent-builder) — Using models with agents
