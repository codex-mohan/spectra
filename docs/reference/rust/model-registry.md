# ModelRegistry Reference

Model configuration and provider enumeration.

## Model

```rust
pub struct Model {
    pub provider: Provider,
    pub name: String,
    pub api_type: Option<String>,
}

impl Model {
    pub fn openai(name: &str) -> Self;
    pub fn anthropic(name: &str) -> Self;
}
```

## Provider Enum

```rust
pub enum Provider {
    OpenAI,
    Anthropic,
}
```

## ModelRegistry

Reads model configurations from `TOML` config files:

```rust
pub struct ModelRegistry {
    models: HashMap<String, Model>,
}

impl ModelRegistry {
    pub fn from_config(path: &str) -> Result<Self>;
    pub fn get(&self, name: &str) -> Option<&Model>;
    pub fn list(&self) -> Vec<&Model>;
}
```

### Config File Format

```toml
[[models]]
name = "gpt-4o"
provider = "openai"
api_type = "chat-completions"

[[models]]
name = "claude-sonnet-4-20250514"
provider = "anthropic"
api_type = "messages"
```

## Related

- [Rust Providers Guide](/rust/providers) — Client implementations
- [LlmClient Reference](/reference/rust/llm-client) — Communication trait
