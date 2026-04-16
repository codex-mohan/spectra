use std::sync::Arc;

use crate::messages::ToolCall;
use crate::tool::ToolResult;

pub trait Extension: Send + Sync {
    fn on_before_tool_call(&self, _tool_call: &ToolCall) {}
    fn on_after_tool_call(&self, _tool_call: &ToolCall, _result: &ToolResult) {}
    fn on_agent_start(&self) {}
    fn on_agent_end(&self) {}
    fn on_turn_start(&self) {}
    fn on_turn_end(&self) {}
}

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

    pub fn on_before_tool_call(&self, tool_call: &ToolCall) {
        for ext in &self.extensions {
            ext.on_before_tool_call(tool_call);
        }
    }

    pub fn on_after_tool_call(&self, tool_call: &ToolCall, result: &ToolResult) {
        for ext in &self.extensions {
            ext.on_after_tool_call(tool_call, result);
        }
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
