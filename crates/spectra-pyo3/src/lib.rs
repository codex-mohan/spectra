use pyo3::prelude::*;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Mutex;

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
    pub parameters: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PyAgentConfig {
    pub model: PyModel,
    #[serde(default)]
    pub system_prompt: Option<String>,
    #[serde(default)]
    pub tools: Vec<PyTool>,
}

struct AgentState {
    config: PyAgentConfig,
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

fn call_llm(config: &PyAgentConfig, messages: Vec<serde_json::Value>, tools: &[PyTool]) -> PyResult<String> {
    let api_key = match get_api_key(&config.model.provider) {
        Some(key) => key,
        None => return Err(pyo3::exceptions::PyValueError::new_err(
            format!("Missing API key for provider: {}", config.model.provider)
        )),
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

    let (url, headers): (&str, Vec<(&str, String)>) = match config.model.provider.as_str() {
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
        _ => return Err(pyo3::exceptions::PyValueError::new_err(
            format!("Unknown provider: {}", config.model.provider)
        )),
    };

    let client = reqwest::blocking::Client::new();
    
    let mut request = client.post(url);
    
    for (name, value) in headers {
        request = request.header(name, value);
    }
    
    let response = request
        .json(&body)
        .send()
        .map_err(|e| pyo3::exceptions::PyConnectionError::new_err(
            format!("Request failed: {}", e)
        ))?;

    if !response.status().is_success() {
        return Err(pyo3::exceptions::PyConnectionError::new_err(
            format!("API error: {}", response.status())
        ));
    }

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

    Ok(content)
}

#[pyclass]
pub struct Agent {
    agent_id: String,
}

#[pymethods]
impl Agent {
    #[new]
    fn new(config: String) -> PyResult<Self> {
        init_agents();
        
        let config: PyAgentConfig = serde_json::from_str(&config)
            .map_err(|e| pyo3::exceptions::PyValueError::new_err(format!("Invalid config: {}", e)))?;
        
        let agent_id = format!("agent_{}", uuid::Uuid::new_v4().to_string());
        
        let mut agents = AGENTS.lock().unwrap();
        if let Some(ref mut map) = *agents {
            map.insert(agent_id.clone(), AgentState {
                config,
                history: Vec::new(),
            });
        }
        
        Ok(Self { agent_id })
    }

    fn run(&self, input: String) -> PyResult<String> {
        let mut agents = AGENTS.lock().unwrap();
        let state = agents
            .as_mut()
            .and_then(|m| m.get_mut(&self.agent_id))
            .ok_or_else(|| pyo3::exceptions::PyValueError::new_err(
                format!("Agent not found: {}", self.agent_id)
            ))?;
        
        let mut events = Vec::new();
        
        events.push(serde_json::json!({"type": "agent_start"}));
        
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
        
        match call_llm(&state.config, messages, &state.config.tools) {
            Ok(content) => {
                events.push(serde_json::json!({
                    "type": "message_update",
                    "delta": content.clone()
                }));
                
                events.push(serde_json::json!({
                    "type": "message_end",
                    "content": content,
                    "stop_reason": "end_turn"
                }));
            },
            Err(e) => {
                events.push(serde_json::json!({
                    "type": "error",
                    "message": e.to_string()
                }));
            }
        }
        
        events.push(serde_json::json!({
            "type": "agent_end",
            "messages": state.history.clone()
        }));
        
        Ok(serde_json::to_string(&events)
            .map_err(|e| pyo3::exceptions::PyValueError::new_err(
                format!("Failed to serialize: {}", e)
            ))?)
    }
    
    #[staticmethod]
    fn get_agents() -> PyResult<Vec<String>> {
        init_agents();
        let agents = AGENTS.lock().unwrap();
        if let Some(ref map) = *agents {
            Ok(map.keys().cloned().collect())
        } else {
            Ok(Vec::new())
        }
    }
}

#[pyfunction]
fn get_agents_py() -> PyResult<Vec<String>> {
    init_agents();
    let agents = AGENTS.lock().unwrap();
    if let Some(ref map) = *agents {
        Ok(map.keys().cloned().collect())
    } else {
        Ok(Vec::new())
    }
}

#[pyfunction]
fn get_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

#[pymodule]
fn spectra(m: &Bound<'_, PyModule>) -> PyResult<()> {
    m.add_function(wrap_pyfunction!(get_version, m)?)?;
    m.add_function(wrap_pyfunction!(get_agents_py, m)?)?;
    m.add_class::<Agent>()?;
    Ok(())
}
