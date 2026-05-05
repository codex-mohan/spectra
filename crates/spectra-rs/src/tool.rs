use crate::error::{Result, SpectraError};
use async_trait::async_trait;
use dashmap::DashMap;
use serde_json::Value;
use std::pin::Pin;
use std::sync::Arc;
use tokio::sync::mpsc;
use tokio::sync::watch;

type ToolFuture = Pin<Box<dyn std::future::Future<Output = Result<ToolResult>> + Send>>;
type ToolFn = Box<dyn Fn(ToolContext) -> ToolFuture + Send + Sync>;

#[derive(Debug, Clone)]
pub struct ToolDef {
    pub name: String,
    pub description: String,
    pub parameters: Value,
}

impl ToolDef {
    pub fn new(name: impl Into<String>, description: impl Into<String>, parameters: Value) -> Self {
        Self {
            name: name.into(),
            description: description.into(),
            parameters,
        }
    }
}

#[derive(Debug, Clone)]
pub struct ToolContext {
    pub tool_call_id: String,
    pub params: Value,
    pub signal: Option<watch::Receiver<bool>>,
    pub progress_tx: Option<mpsc::UnboundedSender<ToolResult>>,
}

impl ToolContext {
    pub fn new(tool_call_id: String, params: Value) -> Self {
        Self {
            tool_call_id,
            params,
            signal: None,
            progress_tx: None,
        }
    }

    pub fn with_signal(tool_call_id: String, params: Value, signal: watch::Receiver<bool>) -> Self {
        Self {
            tool_call_id,
            params,
            signal: Some(signal),
            progress_tx: None,
        }
    }

    pub fn is_aborted(&self) -> bool {
        self.signal.as_ref().is_some_and(|s| *s.borrow())
    }

    pub fn report_progress(&self, result: ToolResult) {
        if let Some(tx) = &self.progress_tx {
            let _ = tx.send(result);
        }
    }
}

#[derive(Debug, Clone)]
pub struct ToolResult {
    pub content: Value,
    pub is_error: bool,
}

impl ToolResult {
    pub fn success(content: Value) -> Self {
        Self {
            content,
            is_error: false,
        }
    }

    pub fn error(message: impl Into<String>) -> Self {
        Self {
            content: serde_json::json!({ "error": message.into() }),
            is_error: true,
        }
    }
}

#[async_trait]
pub trait Tool: Send + Sync {
    fn definition(&self) -> &ToolDef;

    async fn execute(&self, ctx: ToolContext) -> Result<ToolResult>;
}

pub struct ToolRegistry {
    tools: DashMap<String, Arc<dyn Tool>>,
}

impl ToolRegistry {
    pub fn new() -> Self {
        Self {
            tools: DashMap::new(),
        }
    }

    pub fn register(&self, tool: Arc<dyn Tool>) {
        let def = tool.definition();
        self.tools.insert(def.name.clone(), tool);
    }

    pub fn unregister(&self, name: &str) {
        self.tools.remove(name);
    }

    pub fn get(&self, name: &str) -> Option<Arc<dyn Tool>> {
        self.tools.get(name).map(|r| Arc::clone(&r))
    }

    pub fn list(&self) -> Vec<ToolDef> {
        self.tools.iter().map(|r| r.definition().clone()).collect()
    }

    pub fn definitions(&self) -> Vec<ToolDef> {
        self.list()
    }

    pub async fn dispatch(&self, name: &str, ctx: ToolContext) -> Result<ToolResult> {
        let tool = self
            .get(name)
            .ok_or_else(|| SpectraError::ToolNotFound {
                name: name.to_string(),
            })?;

        tool.execute(ctx).await
    }

    pub async fn dispatch_by_name(&self, name: &str, ctx: ToolContext) -> Result<ToolResult> {
        let tool = self
            .get(name)
            .ok_or_else(|| SpectraError::ToolNotFound {
                name: name.to_string(),
            })?;

        tool.execute(ctx).await
    }

    pub fn contains(&self, name: &str) -> bool {
        self.tools.contains_key(name)
    }

    pub fn len(&self) -> usize {
        self.tools.len()
    }

    pub fn is_empty(&self) -> bool {
        self.tools.is_empty()
    }
}

impl Default for ToolRegistry {
    fn default() -> Self {
        Self::new()
    }
}

impl Clone for ToolRegistry {
    fn clone(&self) -> Self {
        Self {
            tools: DashMap::clone(&self.tools),
        }
    }
}

#[allow(clippy::type_complexity)]
pub struct ToolBuilder {
    name: String,
    description: String,
    parameters: Value,
    executor: Option<ToolFn>,
}

impl ToolBuilder {
    pub fn new(name: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            description: String::new(),
            parameters: serde_json::json!({}),
            executor: None,
        }
    }

    pub fn description(mut self, description: impl Into<String>) -> Self {
        self.description = description.into();
        self
    }

    pub fn parameters(mut self, parameters: Value) -> Self {
        self.parameters = parameters;
        self
    }

    pub fn execute<F, Fut>(mut self, f: F) -> Self
    where
        F: Fn(ToolContext) -> Fut + Send + Sync + 'static,
        Fut: std::future::Future<Output = Result<ToolResult>> + Send + 'static,
    {
        self.executor = Some(Box::new(move |ctx| Box::pin(f(ctx))));
        self
    }

    pub fn build(self) -> Arc<dyn Tool> {
        let def = ToolDef::new(&self.name, &self.description, self.parameters);
        let executor = self.executor.expect("executor not set");

        Arc::new(BuiltTool {
            def,
            executor,
        })
    }
}

struct BuiltTool {
    def: ToolDef,
    executor: ToolFn,
}

#[async_trait]
impl Tool for BuiltTool {
    fn definition(&self) -> &ToolDef {
        &self.def
    }

    async fn execute(&self, ctx: ToolContext) -> Result<ToolResult> {
        (self.executor)(ctx).await
    }
}
