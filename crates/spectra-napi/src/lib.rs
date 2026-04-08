use napi::{Env, JsObject, Result, Module};
use napi_derive::{module_exports, js_function};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JsModel {
    pub provider: String,
    pub id: String,
    #[serde(default)]
    pub max_tokens: Option<u32>,
    #[serde(default)]
    pub temperature: Option<f32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JsTool {
    pub name: String,
    pub description: String,
    pub parameters: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JsAgentConfig {
    pub model: JsModel,
    #[serde(default)]
    pub system_prompt: Option<String>,
    #[serde(default)]
    pub tools: Vec<JsTool>,
}

#[module_exports]
fn init(mut module: Module) -> Result<()> {
    module.create_named_method("getVersion", get_version)?;
    module.create_named_method("createAgent", create_agent)?;
    module.create_named_method("runAgent", run_agent)?;
    Ok(())
}

#[js_function]
fn get_version(ctx: napi::CallContext) -> Result<String> {
    Ok(env!("CARGO_PKG_VERSION").to_string())
}

#[js_function]
fn create_agent(ctx: napi::CallContext) -> Result<napi::JsString> {
    let config_str = ctx.get::<napi::JsString>(0)?;
    let config: JsAgentConfig = serde_json::from_str(&config_str.into_utf8()?.to_string()?)
        .map_err(|e| napi::Error::new(
            napi::Status::InvalidArg,
            format!("Failed to parse config: {}", e)
        ))?;
    
    Ok(ctx.env.create_string(&serde_json::to_string(&config).unwrap())?)
}

#[js_function]
fn run_agent(ctx: napi::CallContext) -> Result<napi::JsString> {
    let agent_id = ctx.get::<napi::JsString>(0)?;
    let user_input = ctx.get::<napi::JsString>(1)?;
    
    let input = user_input.into_utf8()?.to_string()?;
    
    // Return a simple event stream as JSON string
    let events = serde_json::json!([
        { "type": "agent_start" },
        { "type": "error", "message": "Native binding stub - implement actual LLM calls" },
        { "type": "agent_end", "messages": [] }
    ]);
    
    Ok(ctx.env.create_string(&events.to_string())?)
}
