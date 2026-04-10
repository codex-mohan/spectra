use napi::threadsafe_function::ErrorStrategy::CalleeHandled;
use napi::threadsafe_function::{ThreadsafeFunction, ThreadsafeFunctionCallMode};
use napi::{CallContext, Env, JsFunction, JsObject, JsString, Status};
use napi_derive::{module_exports, js_function};
use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;
use spectra_core::agent::{Agent, AgentConfig};
use spectra_core::event::{ContentDelta, StreamEvent};
use spectra_core::llm::{LlmClient, Model, Provider};
use spectra_core::tool::ToolRegistry;
use spectra_http::{AnthropicClient, OpenAIClient};
use std::collections::HashMap;
use std::sync::Arc;

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
    pub parameters: JsonValue,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JsAgentConfig {
    pub model: JsModel,
    #[serde(default)]
    pub system_prompt: Option<String>,
    #[serde(default)]
    pub tools: Vec<JsTool>,
}

#[derive(Clone)]
struct JsAgent {
    agent: Arc<Agent>,
}

impl JsAgent {
    fn from_config(config: JsAgentConfig) -> napi::Result<Self> {
        let client: Arc<dyn LlmClient> = match config.model.provider.as_str() {
            "anthropic" => {
                let c = AnthropicClient::with_api_key(
                    std::env::var("ANTHROPIC_API_KEY")
                        .unwrap_or_default(),
                ).map_err(|e| napi::Error::new(Status::InvalidArg, e.to_string()))?;
                Arc::new(c)
            }
            "openai" | "openai-compatible" | "groq" | "openrouter" => {
                let c = OpenAIClient::with_api_key(
                    std::env::var("OPENAI_API_KEY")
                        .or_else(|_| std::env::var("OPENROUTER_API_KEY"))
                        .or_else(|_| std::env::var("GROQ_API_KEY"))
                        .unwrap_or_default(),
                ).map_err(|e| napi::Error::new(Status::InvalidArg, e.to_string()))?;
                Arc::new(c)
            }
            _ => {
                return Err(napi::Error::new(
                    Status::InvalidArg,
                    format!("Unknown provider: {}", config.model.provider),
                ))
            }
        };

        let model = Model::new(
            match config.model.provider.as_str() {
                "anthropic" => Provider::Anthropic,
                _ => Provider::OpenAI,
            },
            config.model.id.clone(),
        );

        let agent_config = AgentConfig {
            model,
            system_prompt: config.system_prompt,
            tools: Arc::new(ToolRegistry::new()),
        };

        Ok(Self {
            agent: Arc::new(Agent::new(client, agent_config)),
        })
    }

    async fn run_with_callback(
        &self,
        user_input: String,
        tsfn: ThreadsafeFunction<String>,
    ) -> napi::Result<()> {
        let (rx, _channel) = self.agent.run(user_input).await.map_err(|e| {
            napi::Error::new(Status::GenericFailure, e.to_string())
        })?;

        tokio::pin!(rx);
        while let Some(event_result) = rx.recv().await {
            match event_result {
                Ok(event) => {
                    let json = serialize_stream_event(&event);
                    let _ = tsfn.call(Ok(json), ThreadsafeFunctionCallMode::NonBlocking);
                }
                Err(e) => {
                    let json = serde_json::json!({
                        "type": "error",
                        "message": e.to_string()
                    });
                    let _ = tsfn.call(Ok(json.to_string()), ThreadsafeFunctionCallMode::NonBlocking);
                }
            }
        }

        Ok(())
    }
}

fn serialize_stream_event(event: &StreamEvent) -> String {
    match event {
        StreamEvent::AgentStart => {
            serde_json::json!({ "type": "agent_start" }).to_string()
        }
        StreamEvent::TurnStart => {
            serde_json::json!({ "type": "turn_start" }).to_string()
        }
        StreamEvent::MessageStart { message } => {
            serde_json::json!({
                "type": "message_start",
                "message": message
            }).to_string()
        }
        StreamEvent::MessageUpdate { delta } => {
            serde_json::json!({
                "type": "message_update",
                "delta": serialize_content_delta(delta)
            }).to_string()
        }
        StreamEvent::MessageEnd { message } => {
            serde_json::json!({
                "type": "message_end",
                "message": message
            }).to_string()
        }
        StreamEvent::TurnEnd { tool_results } => {
            serde_json::json!({
                "type": "turn_end",
                "tool_results": tool_results
            }).to_string()
        }
        StreamEvent::ToolExecutionStart { tool_call } => {
            serde_json::json!({
                "type": "tool_execution_start",
                "tool_call": tool_call
            }).to_string()
        }
        StreamEvent::ToolExecutionUpdate { partial } => {
            serde_json::json!({
                "type": "tool_execution_update",
                "partial": partial
            }).to_string()
        }
        StreamEvent::ToolExecutionEnd { result, is_error } => {
            serde_json::json!({
                "type": "tool_execution_end",
                "result": result,
                "is_error": is_error
            }).to_string()
        }
        StreamEvent::AgentEnd { messages } => {
            serde_json::json!({
                "type": "agent_end",
                "messages": messages
            }).to_string()
        }
        StreamEvent::Error { message } => {
            serde_json::json!({
                "type": "error",
                "message": message
            }).to_string()
        }
    }
}

fn serialize_content_delta(delta: &ContentDelta) -> JsonValue {
    match delta {
        ContentDelta::Text { delta: text } => {
            serde_json::json!({ "type": "text", "delta": text })
        }
        ContentDelta::ToolCallStart { id, name } => {
            serde_json::json!({ "type": "tool_call_start", "id": id, "name": name })
        }
        ContentDelta::ToolCallDelta { id, args_delta } => {
            serde_json::json!({ "type": "tool_call_delta", "id": id, "args_delta": args_delta })
        }
        ContentDelta::ToolCallEnd { id } => {
            serde_json::json!({ "type": "tool_call_end", "id": id })
        }
    }
}

#[derive(Clone)]
struct AgentState {
    agent: JsAgent,
}

static AGENTS: std::sync::Mutex<Option<HashMap<String, AgentState>>> = std::sync::Mutex::new(None);

fn init_agents() {
    let mut guard = AGENTS.lock().unwrap();
    if guard.is_none() {
        *guard = Some(HashMap::new());
    }
}

#[js_function(2)]
fn create_agent(ctx: CallContext) -> napi::Result<String> {
    init_agents();
    let config_str = ctx.get::<JsString>(0)?;
    let config_str = config_str.into_utf8()?.as_str()?.to_string();

    let config: JsAgentConfig = serde_json::from_str(&config_str)
        .map_err(|e| napi::Error::new(Status::InvalidArg, format!("Failed to parse config: {}", e)))?;

    let agent = JsAgent::from_config(config)?;

    let agent_id = format!("agent_{}", uuid::Uuid::new_v4());

    let mut agents = AGENTS.lock().unwrap();
    if let Some(ref mut map) = *agents {
        map.insert(agent_id.clone(), AgentState { agent });
    }

    Ok(agent_id)
}

#[js_function(2)]
fn run_agent(ctx: CallContext) -> napi::Result<String> {
    init_agents();
    let agent_id_str = ctx.get::<JsString>(0)?;
    let agent_id = agent_id_str.into_utf8()?.as_str()?.to_string();
    let callback_fn = ctx.get::<JsFunction>(1)?;

    let tsfn: ThreadsafeFunction<String> = callback_fn
        .create_threadsafe_function::<String, String, _, CalleeHandled>(256, |_ctx: napi::threadsafe_function::ThreadSafeCallContext<String>| {
            Ok::<Vec<String>, napi::Error>(vec![])
        })
        .map_err(|e| napi::Error::new(Status::GenericFailure, format!("Failed to build threadsafe function: {}", e)))?;

    let agents = AGENTS.lock().unwrap();
    let state = agents
        .as_ref()
        .and_then(|m| m.get(&agent_id))
        .ok_or_else(|| napi::Error::new(Status::InvalidArg, format!("Agent not found: {}", agent_id)))?
        .clone();
    drop(agents);

    let tsfn_clone = tsfn.clone();
    let js_agent = state.agent.clone();
    let tsfn_err = tsfn.clone();

    napi::tokio::spawn(async move {
        let user_input = "Hello".to_string();
        if let Err(e) = js_agent.run_with_callback(user_input, tsfn_clone).await {
            let json = serde_json::json!({
                "type": "error",
                "message": e.to_string()
            });
            let _ = tsfn_err.call(Ok(json.to_string()), ThreadsafeFunctionCallMode::NonBlocking);
        }
    });

    Ok(serde_json::json!({ "status": "started" }).to_string())
}

#[js_function(2)]
fn run_agent_with_input(ctx: CallContext) -> napi::Result<String> {
    init_agents();
    let agent_id_str = ctx.get::<JsString>(0)?;
    let agent_id = agent_id_str.into_utf8()?.as_str()?.to_string();
    let user_input_str = ctx.get::<JsString>(1)?;
    let user_input = user_input_str.into_utf8()?.as_str()?.to_string();
    let callback_fn = ctx.get::<JsFunction>(2)?;

    let tsfn: ThreadsafeFunction<String> = callback_fn
        .create_threadsafe_function::<String, String, _, CalleeHandled>(256, |_ctx: napi::threadsafe_function::ThreadSafeCallContext<String>| {
            Ok::<Vec<String>, napi::Error>(vec![])
        })
        .map_err(|e| napi::Error::new(Status::GenericFailure, format!("Failed to build threadsafe function: {}", e)))?;

    let agents = AGENTS.lock().unwrap();
    let state = agents
        .as_ref()
        .and_then(|m| m.get(&agent_id))
        .ok_or_else(|| napi::Error::new(Status::InvalidArg, format!("Agent not found: {}", agent_id)))?
        .clone();
    drop(agents);

    let tsfn_clone = tsfn.clone();
    let js_agent = state.agent.clone();
    let tsfn_err = tsfn.clone();
    let user_input_owned = user_input.clone();

    napi::tokio::spawn(async move {
        if let Err(e) = js_agent.run_with_callback(user_input_owned, tsfn_clone).await {
            let json = serde_json::json!({
                "type": "error",
                "message": e.to_string()
            });
            let _ = tsfn_err.call(Ok(json.to_string()), ThreadsafeFunctionCallMode::NonBlocking);
        }
    });

    Ok(serde_json::json!({ "status": "started" }).to_string())
}

#[js_function(1)]
fn get_agents(_ctx: CallContext) -> napi::Result<String> {
    init_agents();
    let agents = AGENTS.lock().unwrap();
    let keys: Vec<String> = if let Some(ref map) = *agents {
        map.keys().cloned().collect()
    } else {
        Vec::new()
    };
    Ok(serde_json::to_string(&keys).unwrap_or_else(|_| "[]".to_string()))
}

#[js_function(1)]
fn delete_agent(ctx: CallContext) -> napi::Result<bool> {
    init_agents();
    let agent_id_str = ctx.get::<JsString>(0)?;
    let agent_id = agent_id_str.into_utf8()?.as_str()?.to_string();

    let mut agents = AGENTS.lock().unwrap();
    if let Some(ref mut map) = *agents {
        Ok(map.remove(&agent_id).is_some())
    } else {
        Ok(false)
    }
}

#[js_function]
fn get_version(_ctx: CallContext) -> napi::Result<String> {
    Ok(env!("CARGO_PKG_VERSION").to_string())
}

#[module_exports]
fn init(mut exports: JsObject, _env: Env) -> napi::Result<()> {
    exports.create_named_method("getVersion", get_version)?;
    exports.create_named_method("createAgent", create_agent)?;
    exports.create_named_method("runAgent", run_agent)?;
    exports.create_named_method("runAgentWithInput", run_agent_with_input)?;
    exports.create_named_method("getAgents", get_agents)?;
    exports.create_named_method("deleteAgent", delete_agent)?;
    Ok(())
}
