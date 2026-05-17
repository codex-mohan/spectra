use std::sync::Arc;

use crate::messages::ToolCall;
use crate::tool::{ToolContext, ToolResult};
use serde_json::Value;

#[derive(Debug, Clone)]
pub enum BeforeToolCallAction {
    Allow,
    Block { reason: String },
    Transform { modified_args: Value },
}

#[derive(Debug, Clone)]
pub enum AfterToolCallAction {
    Passthrough,
    Replace { result: ToolResult },
}

pub trait Extension: Send + Sync {
    fn on_before_tool_call(
        &self,
        _tool_call: &ToolCall,
        _ctx: &ToolContext,
    ) -> BeforeToolCallAction {
        BeforeToolCallAction::Allow
    }

    fn on_after_tool_call(
        &self,
        _tool_call: &ToolCall,
        _ctx: &ToolContext,
        _result: &ToolResult,
    ) -> AfterToolCallAction {
        AfterToolCallAction::Passthrough
    }

    fn on_agent_start(&self) {}

    fn on_agent_end(&self) {}

    fn on_turn_start(&self) {}

    fn on_turn_end(&self) {}
}

#[derive(Clone)]
pub struct ExtensionManager {
    extensions: Vec<Arc<dyn Extension>>,
}

impl ExtensionManager {
    pub fn new() -> Self {
        Self {
            extensions: Vec::new(),
        }
    }

    pub fn add<E: Extension + 'static>(&mut self, ext: E) {
        self.extensions.push(Arc::new(ext));
    }

    pub fn on_before_tool_call(
        &self,
        tool_call: &ToolCall,
        ctx: &ToolContext,
    ) -> Vec<BeforeToolCallAction> {
        self.extensions
            .iter()
            .map(|ext| ext.on_before_tool_call(tool_call, ctx))
            .collect()
    }

    pub fn on_after_tool_call(
        &self,
        tool_call: &ToolCall,
        ctx: &ToolContext,
        result: &ToolResult,
    ) -> Vec<AfterToolCallAction> {
        self.extensions
            .iter()
            .map(|ext| ext.on_after_tool_call(tool_call, ctx, result))
            .collect()
    }

    pub fn on_agent_start(&self) {
        for ext in &self.extensions {
            ext.on_agent_start();
        }
    }

    pub fn on_agent_end(&self) {
        for ext in &self.extensions {
            ext.on_agent_end();
        }
    }

    pub fn on_turn_start(&self) {
        for ext in &self.extensions {
            ext.on_turn_start();
        }
    }

    pub fn on_turn_end(&self) {
        for ext in &self.extensions {
            ext.on_turn_end();
        }
    }
}

impl Default for ExtensionManager {
    fn default() -> Self {
        Self::new()
    }
}
