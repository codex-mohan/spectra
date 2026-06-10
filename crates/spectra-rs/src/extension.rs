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

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    struct TestExtension {
        before_count: std::sync::atomic::AtomicU32,
        after_count: std::sync::atomic::AtomicU32,
        start_count: std::sync::atomic::AtomicU32,
        end_count: std::sync::atomic::AtomicU32,
    }

    impl TestExtension {
        fn new() -> Self {
            Self {
                before_count: std::sync::atomic::AtomicU32::new(0),
                after_count: std::sync::atomic::AtomicU32::new(0),
                start_count: std::sync::atomic::AtomicU32::new(0),
                end_count: std::sync::atomic::AtomicU32::new(0),
            }
        }
    }

    impl Extension for TestExtension {
        fn on_before_tool_call(&self, _tc: &ToolCall, _ctx: &ToolContext) -> BeforeToolCallAction {
            self.before_count.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
            BeforeToolCallAction::Allow
        }

        fn on_after_tool_call(&self, _tc: &ToolCall, _ctx: &ToolContext, _result: &ToolResult) -> AfterToolCallAction {
            self.after_count.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
            AfterToolCallAction::Passthrough
        }

        fn on_agent_start(&self) {
            self.start_count.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        }

        fn on_agent_end(&self) {
            self.end_count.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        }
    }

    #[test]
    fn test_extension_manager_new_is_empty() {
        let mgr = ExtensionManager::new();
        let tc = ToolCall { id: "1".into(), name: "t".into(), arguments: json!({}), thinking_signature: None };
        let ctx = ToolContext::new("1".into(), json!({}));
        let actions = mgr.on_before_tool_call(&tc, &ctx);
        assert!(actions.is_empty());
    }

    #[test]
    fn test_extension_manager_dispatches_to_all() {
        let mut mgr = ExtensionManager::new();
        let ext = TestExtension::new();
        mgr.add(ext);

        let tc = ToolCall { id: "1".into(), name: "t".into(), arguments: json!({}), thinking_signature: None };
        let ctx = ToolContext::new("1".into(), json!({}));

        let before_actions = mgr.on_before_tool_call(&tc, &ctx);
        assert_eq!(before_actions.len(), 1);
        match &before_actions[0] {
            BeforeToolCallAction::Allow => {},
            _ => panic!("Expected Allow"),
        }
    }

    #[test]
    fn test_extension_manager_broadcasts_lifecycle() {
        let mut mgr = ExtensionManager::new();
        let ext1 = TestExtension::new();
        let ext2 = TestExtension::new();
        mgr.add(ext1);
        mgr.add(ext2);

        mgr.on_agent_start();
        mgr.on_agent_end();
        mgr.on_turn_start();
        mgr.on_turn_end();

        // No panics = passes
    }

    #[test]
    fn test_multiple_extensions_before_tool_call() {
        struct BlockExt;
        impl Extension for BlockExt {
            fn on_before_tool_call(&self, _tc: &ToolCall, _ctx: &ToolContext) -> BeforeToolCallAction {
                BeforeToolCallAction::Block { reason: "nope".into() }
            }
        }

        struct TransformExt;
        impl Extension for TransformExt {
            fn on_before_tool_call(&self, _tc: &ToolCall, _ctx: &ToolContext) -> BeforeToolCallAction {
                BeforeToolCallAction::Transform { modified_args: json!({"x": 1}) }
            }
        }

        let mut mgr = ExtensionManager::new();
        mgr.add(BlockExt);
        mgr.add(TransformExt);

        let tc = ToolCall { id: "b1".into(), name: "b".into(), arguments: json!({}), thinking_signature: None };
        let ctx = ToolContext::new("b1".into(), json!({}));
        let actions = mgr.on_before_tool_call(&tc, &ctx);
        assert_eq!(actions.len(), 2);
    }

    #[test]
    fn test_default_extension_trait_implementations() {
        struct MinimalExt;
        impl Extension for MinimalExt {}

        let ext = MinimalExt;
        let tc = ToolCall { id: "m".into(), name: "m".into(), arguments: json!({}), thinking_signature: None };
        let ctx = ToolContext::new("m".into(), json!({}));

        let action = ext.on_before_tool_call(&tc, &ctx);
        match action {
            BeforeToolCallAction::Allow => {},
            _ => panic!("Default should be Allow"),
        }

        let result = ToolResult::success(json!({}));
        let action = ext.on_after_tool_call(&tc, &ctx, &result);
        match action {
            AfterToolCallAction::Passthrough => {},
            _ => panic!("Default should be Passthrough"),
        }
    }

    #[test]
    fn test_after_tool_call_replace_action() {
        struct ReplaceExt;
        impl Extension for ReplaceExt {
            fn on_after_tool_call(&self, _tc: &ToolCall, _ctx: &ToolContext, _result: &ToolResult) -> AfterToolCallAction {
                AfterToolCallAction::Replace {
                    result: ToolResult::success(json!({"replaced": true})),
                }
            }
        }

        let mut mgr = ExtensionManager::new();
        mgr.add(ReplaceExt);

        let tc = ToolCall { id: "r".into(), name: "r".into(), arguments: json!({}), thinking_signature: None };
        let ctx = ToolContext::new("r".into(), json!({}));
        let result = ToolResult::success(json!({}));
        let actions = mgr.on_after_tool_call(&tc, &ctx, &result);
        assert_eq!(actions.len(), 1);
        match &actions[0] {
            AfterToolCallAction::Replace { result } => {
                assert_eq!(result.content, json!({"replaced": true}));
            }
            _ => panic!("Expected Replace"),
        }
    }
}
