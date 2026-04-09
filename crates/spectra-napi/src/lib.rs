use napi::{Env, Result, JsString, JsObject};
use napi_derive::{module_exports, js_function};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Mutex;

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

struct AgentState {
    config: JsAgentConfig,
    history: Vec<serde_json::Value>,
}

static AGENTS: Mutex<Option<HashMap<String, AgentState>>> = Mutex::new(None);

fn init_agents() {
    let mut guard = AGENTS.lock().unwrap();
    if guard.is_none() {
        *guard = Some(HashMap::new());
    }
}

fn get_api_key(provider: &str) -> Option<String> {
    match provider {
        "anthropic" => std::env::var("ANTHROPIC_API_KEY").ok(),
        "openai" => std::env::var("OPENAI_API_KEY").ok(),
        "groq" => std::env::var("GROQ_API_KEY").ok(),
        _ => None,
    }
}

fn call_llm_sync(config: &JsAgentConfig, messages: Vec<serde_json::Value>, tools: &[JsTool]) -> Result<Vec<String>> {
    let api_key = match get_api_key(&config.model.provider) {
        Some(key) => key,
        None => return Ok(vec![r#"{"type":"error","message":"Missing API key"}"#.to_string()]),
    };

    let max_tokens = config.model.max_tokens.unwrap_or(4096);
    let temperature = config.model.temperature;

    let body = serde_json::json!({
        "model": config.model.id,
        "max_tokens": max_tokens,
        "messages": messages,
        "tools": tools.iter().map(|t| {
            serde_json::json!({
                "name": t.name,
                "description": t.description,
                "input_schema": t.parameters
            })
        }).collect::<Vec<_>>(),
        "temperature": temperature,
    });

    let (url, headers) = match config.model.provider.as_str() {
        "anthropic" => (
            "https://api.anthropic.com/v1/messages",
            vec![
                ("x-api-key", api_key),
                ("anthropic-version", "2023-06-01".to_string()),
                ("content-type", "application/json".to_string()),
            ]
        ),
        "openai" => (
            "https://api.openai.com/v1/chat/completions",
            vec![
                ("authorization", format!("Bearer {}", api_key)),
                ("content-type", "application/json".to_string()),
            ]
        ),
        "groq" => (
            "https://api.groq.com/openai/v1/chat/completions",
            vec![
                ("authorization", format!("Bearer {}", api_key)),
                ("content-type", "application/json".to_string()),
            ]
        ),
        _ => return Ok(vec![r#"{"type":"error","message":"Unknown provider"}"#.to_string()]),
    };

    let client = reqwest::blocking::Client::new();
    
    let mut request = client.post(url);
    
    for (name, value) in headers {
        request = request.header(name, &value);
    }
    
    let request = request.json(&body);

    match request.send() {
        Ok(response) => {
            if response.status().is_success() {
                let data: serde_json::Value = response.json().unwrap_or_default();
                
                let content = if config.model.provider == "anthropic" {
                    data.get("content")
                        .and_then(|c| c.as_array())
                        .map(|arr| {
                            arr.iter()
                                .filter_map(|c| c.get("text").and_then(|t| t.as_str()))
                                .collect::<String>()
                        })
                        .unwrap_or_default()
                } else {
                    data.get("choices")
                        .and_then(|c| c.as_array())
                        .and_then(|arr| arr.first())
                        .and_then(|choice| choice.get("message"))
                        .and_then(|m| m.get("content"))
                        .and_then(|c| c.as_str())
                        .unwrap_or("")
                        .to_string()
                };
                
                Ok(vec![serde_json::json!({
                    "type": "message_update",
                    "delta": content
                }).to_string()])
            } else {
                Ok(vec![serde_json::json!({
                    "type": "error",
                    "message": format!("API error: {}", response.status())
                }).to_string()])
            }
        }
        Err(e) => Ok(vec![serde_json::json!({
            "type": "error",
            "message": format!("Request failed: {}", e)
        }).to_string()]),
    }
}

#[js_function]
fn get_version(_ctx: napi::CallContext) -> Result<String> {
    Ok(env!("CARGO_PKG_VERSION").to_string())
}

#[js_function]
fn create_agent(ctx: napi::CallContext) -> Result<String> {
    init_agents();
    let config_str = ctx.get::<JsString>(0)?;
    let config_str = config_str.into_utf8()?.as_str()?.to_string();
    
    let config: JsAgentConfig = serde_json::from_str(&config_str)
        .map_err(|e| napi::Error::new(
            napi::Status::InvalidArg,
            format!("Failed to parse config: {}", e)
        ))?;
    
    let agent_id = format!("agent_{}", uuid::Uuid::new_v4());
    
    let mut agents = AGENTS.lock().unwrap();
    if let Some(ref mut map) = *agents {
        map.insert(agent_id.clone(), AgentState {
            config,
            history: Vec::new(),
        });
    }
    
    Ok(agent_id)
}

#[js_function]
fn run_agent(ctx: napi::CallContext) -> Result<String> {
    init_agents();
    let agent_id = ctx.get::<JsString>(0)?;
    let user_input = ctx.get::<JsString>(1)?;
    
    let id = agent_id.into_utf8()?.as_str()?.to_string();
    let input = user_input.into_utf8()?.as_str()?.to_string();
    
    let mut agents = AGENTS.lock().unwrap();
    let state = agents
        .as_mut()
        .and_then(|m| m.get_mut(&id))
        .ok_or_else(|| napi::Error::new(
            napi::Status::InvalidArg,
            format!("Agent not found: {}", id)
        ))?;
    
    let mut events = Vec::new();
    
    events.push(r#"{"type":"agent_start"}"#.to_string());
    
    let user_message = serde_json::json!({
        "role": "user",
        "content": input.clone()
    });
    state.history.push(user_message.clone());
    
    let mut messages: Vec<serde_json::Value> = Vec::new();
    
    if let Some(ref system) = state.config.system_prompt {
        messages.push(serde_json::json!({
            "role": "system",
            "content": system
        }));
    }
    
    messages.extend(state.history.clone());
    
    let llm_events = call_llm_sync(&state.config, messages, &state.config.tools)?;
    
    for event in llm_events {
        events.push(event);
    }
    
    events.push(r#"{"type":"message_end","content":"","stop_reason":"end_turn"}"#.to_string());
    events.push(r#"{"type":"agent_end"}"#.to_string());
    
    Ok(format!("[{}]", events.join(",")))
}

#[js_function]
fn get_agents(_ctx: napi::CallContext) -> Result<String> {
    init_agents();
    let agents = AGENTS.lock().unwrap();
    let keys: Vec<String> = if let Some(ref map) = *agents {
        map.keys().cloned().collect()
    } else {
        Vec::new()
    };
    
    Ok(serde_json::to_string(&keys).unwrap_or_else(|_| "[]".to_string()))
}

#[module_exports]
fn init(mut exports: JsObject, _env: Env) -> Result<()> {
    exports.create_named_method("getVersion", get_version)?;
    exports.create_named_method("createAgent", create_agent)?;
    exports.create_named_method("runAgent", run_agent)?;
    exports.create_named_method("getAgents", get_agents)?;
    Ok(())
}
