use pyo3::prelude::*;
use serde::{Deserialize, Serialize};

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

#[pyclass]
pub struct Agent {
    config: PyAgentConfig,
}

#[pymethods]
impl Agent {
    #[new]
    fn new(config: String) -> PyResult<Self> {
        let config: PyAgentConfig = serde_json::from_str(&config)
            .map_err(|e| pyo3::exceptions::PyValueError::new_err(format!("Invalid config: {}", e)))?;
        Ok(Self { config })
    }

    fn run(&self, input: String) -> PyResult<String> {
        let events = serde_json::json!([
            { "type": "agent_start" },
            { "type": "error", "message": "Native binding stub - implement actual LLM calls" },
            { "type": "agent_end", "messages": [] }
        ]);
        Ok(events.to_string())
    }
}

#[pyfunction]
fn get_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

#[pymodule]
fn spectra(_py: Python, m: &PyModule) -> PyResult<()> {
    m.add_function(wrap_pyfunction!(get_version, m)?)?;
    m.add_class::<Agent>()?;
    Ok(())
}
