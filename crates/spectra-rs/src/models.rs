use crate::{ModelInfo, ModelRegistry, Provider, Result};
use std::path::Path;

pub fn default_models() -> ModelRegistry {
    ModelRegistry::new()
}

pub fn load_models(path: impl AsRef<Path>) -> Result<ModelRegistry> {
    ModelRegistry::load_from_file(path.as_ref())
}

pub fn load_builtin_models() -> Result<ModelRegistry> {
    let models_path = Path::new(env!("CARGO_MANIFEST_DIR")).join("models.toml");
    if models_path.exists() {
        ModelRegistry::load_from_file(&models_path)
    } else {
        Ok(ModelRegistry::new())
    }
}

pub fn anthropic_models(registry: &ModelRegistry) -> Vec<&ModelInfo> {
    registry.by_provider(Provider::Anthropic)
}

pub fn openai_models(registry: &ModelRegistry) -> Vec<&ModelInfo> {
    registry.by_provider(Provider::OpenAI)
}

pub fn groq_models(registry: &ModelRegistry) -> Vec<&ModelInfo> {
    registry.by_provider(Provider::Groq)
}
