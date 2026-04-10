use pyo3::prelude::*;
use pyo3::exceptions::PyValueError;
use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;
use spectra_core::agent::{Agent, AgentConfig};
use spectra_core::event::{ContentDelta, StreamEvent};
use spectra_core::llm::{LlmClient, Model, Provider};
use spectra_core::tool::ToolRegistry;
use spectra_http::{AnthropicClient, OpenAIClient};
use std::sync::Arc;
use std::collections::HashMap;
use std::sync::Mutex;
use futures::stream::StreamExt;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PyModel {
    pub provider: String,
    pub id: String,
    #[serde(default)]
    pub max_tokens: Option<u32>,
    #[serde(default)]
    pub temperature: Option<f32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PyTool {
    pub name: String,
    pub description: String,
    pub parameters: JsonValue,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PyAgentConfig {
    pub model: PyModel,
    #[serde(default)]
    pub system_prompt: Option<String>,
    #[serde(default)]
    pub tools: Vec<PyTool>,
}

#[derive(Clone)]
struct PyAgent {
    agent: Arc<Agent>,
}

impl PyAgent {
    fn from_config(config: PyAgentConfig) -> PyResult<Self> {
        let client: Arc<dyn LlmClient> = match config.model.provider.as_str() {
            "anthropic" => {
                let api_key = std::env::var("ANTHROPIC_API_KEY")
                    .unwrap_or_default();
                let c = AnthropicClient::with_api_key(api_key)
                    .map_err(|e| PyValueError::new_err(e.to_string()))?;
                Arc::new(c)
            }
            "openai" | "openai-compatible" | "groq" | "openrouter" => {
                let api_key = std::env::var("OPENAI_API_KEY")
                    .or_else(|_| std::env::var("OPENROUTER_API_KEY"))
                    .or_else(|_| std::env::var("GROQ_API_KEY"))
                    .unwrap_or_default();
                let c = OpenAIClient::with_api_key(api_key)
                    .map_err(|e| PyValueError::new_err(e.to_string()))?;
                Arc::new(c)
            }
            _ => {
                return Err(PyValueError::new_err(format!(
                    "Unknown provider: {}",
                    config.model.provider
                )));
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

    async fn run_streaming(
        &self,
        user_input: String,
    ) -> PyResult<Vec<String>> {
        let (rx, _channel) = self
            .agent
            .run(user_input)
            .await
            .map_err(|e| PyValueError::new_err(e.to_string()))?;

        let mut events = Vec::new();
        let mut stream = rx;
        while let Some(event_result) = stream.next().await {
            match event_result {
                Ok(event) => {
                    events.push(serialize_stream_event(&event));
                }
                Err(e) => {
                    events.push(serde_json::json!({
                        "type": "error",
                        "message": e.to_string()
                    }).to_string());
                }
            }
        }
        Ok(events)
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

struct AgentRegistry {
    agents: Mutex<HashMap<String, PyAgent>>,
}

static AGENTS: Mutex<Option<HashMap<String, PyAgent>>> = Mutex::new(None);

fn init_agents() {
    let mut guard = AGENTS.lock().unwrap();
    if guard.is_none() {
        *guard = Some(HashMap::new());
    }
}

#[pyclass]
struct Agent {
    id: String,
}

#[pymethods]
impl Agent {
    #[new]
    fn new(config_json: String) -> PyResult<Self> {
        init_agents();
        let config: PyAgentConfig = serde_json::from_str(&config_json)
            .map_err(|e| PyValueError::new_err(format!("Failed to parse config: {}", e)))?;

        let py_agent = PyAgent::from_config(config)?;

        let id = format!("agent_{}", uuid::Uuid::new_v4());

        let mut agents = AGENTS.lock().unwrap();
        if let Some(ref mut map) = *agents {
            map.insert(id.clone(), py_agent);
        }

        Ok(Self { id })
    }

    fn run(&self, user_input: String) -> PyResult<String> {
        init_agents();
        let agents = AGENTS.lock().unwrap();
        let py_agent = agents
            .as_ref()
            .and_then(|m| m.get(&self.id))
            .ok_or_else(|| PyValueError::new_err(format!("Agent not found: {}", self.id)))?
            .clone();
        drop(agents);

        let rt = tokio::runtime::Runtime::new()
            .map_err(|e| PyValueError::new_err(e.to_string()))?;
        let events = rt.block_on(py_agent.agent.run(user_input)).map_err(|e| {
            PyValueError::new_err(e.to_string())
        }).0;

        let mut result = Vec::new();
        while let Some(event_result) = rt.block_on(events.recv()).ok() {
            match event_result {
                Ok(event) => {
                    result.push(serde_json::json!({
                        "type": "event",
                        "data": serialize_stream_event(&event)
                    }));
                }
                Err(e) => {
                    result.push(serde_json::json!({
                        "type": "error",
                        "message": e.to_string()
                    }));
                }
            }
        }
        Ok(serde_json::to_string(&result).unwrap_or_else(|_| "[]".to_string()))
    }

    fn run_async(&self, py: Python<'_>, user_input: String) -> PyResult<Py<PyAny>> {
        use pyo3_asyncio::into_ref;
        init_agents();
        let agents = AGENTS.lock().unwrap();
        let py_agent = agents
            .as_ref()
            .and_then(|m| m.get(&self.id))
            .ok_or_else(|| PyValueError::new_err(format!("Agent not found: {}", self.id)))?
            .clone();
        drop(agents);

        let agent_id = self.id.clone();
        let user_input_owned = user_input.clone();

        pyo3_asyncio::async_runtime::future_into_py(py, async move {
            init_agents();
            let agents = AGENTS.lock().unwrap();
            let py_agent = agents
                .as_ref()
                .and_then(|m| m.get(&agent_id))
                .cloned()
                .ok_or_else(|| PyValueError::new_err(format!("Agent not found: {}", agent_id)))?;
            drop(agents);

            let (rx, _channel) = py_agent.agent.run(user_input_owned).await
                .map_err(|e| PyValueError::new_err(e.to_string()))?;

            let mut stream = rx;
            let mut result = Vec::new();
            while let Some(event_result) = stream.next().await {
                match event_result {
                    Ok(event) => {
                        result.push(serde_json::json!({
                            "type": "event",
                            "data": serialize_stream_event(&event)
                        }));
                    }
                    Err(e) => {
                        result.push(serde_json::json!({
                            "type": "error",
                            "message": e.to_string()
                        }));
                    }
                }
            }
            Ok(result)
        })
    }
}

#[pyfunction]
fn get_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

#[pyfunction]
fn get_agents() -> String {
    init_agents();
    let agents = AGENTS.lock().unwrap();
    let keys: Vec<String> = if let Some(ref map) = *agents {
        map.keys().cloned().collect()
    } else {
        Vec::new()
    };
    serde_json::to_string(&keys).unwrap_or_else(|_| "[]".to_string())
}

#[pyfunction]
fn delete_agent(agent_id: String) -> bool {
    init_agents();
    let mut agents = AGENTS.lock().unwrap();
    if let Some(ref mut map) = *agents {
        map.remove(&agent_id).is_some()
    } else {
        false
    }
}

#[pymodule]
fn _native(m: &Bound<'_, PyModule>) -> PyResult<()> {
    m.add_class::<Agent>()?;
    m.add_function(wrap_pyfunction!(get_version, m)?)?;
    m.add_function(wrap_pyfunction!(get_agents, m)?)?;
    m.add_function(wrap_pyfunction!(delete_agent, m)?)?;
    Ok(())
}
