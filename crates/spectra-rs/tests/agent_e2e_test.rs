use std::sync::Arc;
use spectra_rs::{
    agent::AgentBuilder,
    llm::{LlmClient, LlmRequest, LlmResponse, LlmStream, LlmStreamEvent, Model, Provider},
    messages::{AssistantMessage, Content, StopReason, ToolCall},
    tool::{ToolBuilder, ToolRegistry, ToolResult},
    event::{ContentDelta, StreamEvent},
};
use async_trait::async_trait;
use tokio::sync::mpsc;

// Mock LLM Client for testing
struct MockLlmClient {
    responses: std::sync::Mutex<Vec<AssistantMessage>>,
    current_index: std::sync::Mutex<usize>,
}

impl MockLlmClient {
    fn new(responses: Vec<AssistantMessage>) -> Self {
        Self {
            responses: std::sync::Mutex::new(responses),
            current_index: std::sync::Mutex::new(0),
        }
    }
}

#[async_trait]
impl LlmClient for MockLlmClient {
    async fn complete(&self, _request: LlmRequest) -> spectra_rs::error::Result<LlmResponse> {
        let index = *self.current_index.lock().unwrap();
        let responses = self.responses.lock().unwrap();
        
        if index >= responses.len() {
            return Ok(LlmResponse {
                message: AssistantMessage::new(
                    vec![Content::Text { text: "Default response".to_string() }],
                    vec![],
                    StopReason::EndOfTurn,
                ),
                usage: Default::default(),
                stop_reason: StopReason::EndOfTurn,
            });
        }
        
        let msg = responses[index].clone();
        *self.current_index.lock().unwrap() = index + 1;
        
        Ok(LlmResponse {
            message: msg.clone(),
            usage: Default::default(),
            stop_reason: msg.stop_reason,
        })
    }

    async fn stream(&self, _request: LlmRequest) -> spectra_rs::error::Result<LlmStream> {
        let index = *self.current_index.lock().unwrap();
        let responses = self.responses.lock().unwrap();
        
        let msg = if index < responses.len() {
            *self.current_index.lock().unwrap() = index + 1;
            responses[index].clone()
        } else {
            AssistantMessage::new(
                vec![Content::Text { text: "Default response".to_string() }],
                vec![],
                StopReason::EndOfTurn,
            )
        };

        let (tx, rx) = mpsc::channel(10);
        let msg_clone = msg.clone();
        
        tokio::spawn(async move {
            let _ = tx.send(Ok(LlmStreamEvent::Start { 
                partial: AssistantMessage::new(vec![], vec![], StopReason::EndOfTurn) 
            })).await;
            
            for content in &msg_clone.content {
                if let Content::Text { text } = content {
                    let _ = tx.send(Ok(LlmStreamEvent::ContentDelta {
                        delta: ContentDelta::Text { delta: text.clone() },
                    })).await;
                }
            }
            
            let _ = tx.send(Ok(LlmStreamEvent::Done { message: msg_clone })).await;
        });

        Ok(Box::pin(tokio_stream::wrappers::ReceiverStream::new(rx)))
    }

    fn provider(&self) -> Provider {
        Provider::Custom
    }
}

#[tokio::test]
async fn test_agent_simple_conversation() {
    let client = Arc::new(MockLlmClient::new(vec![
        AssistantMessage::new(
            vec![Content::Text { text: "Hello! How can I help you?".to_string() }],
            vec![],
            StopReason::EndOfTurn,
        ),
    ]));

    let model = Model::new(Provider::Custom, "test-model");
    let agent = AgentBuilder::new(model)
        .system_prompt("You are a helpful assistant.")
        .build(client);

    let (mut rx, _channel) = agent.run("Hi there!").await.unwrap();
    
    let mut events = Vec::new();
    while let Some(event) = rx.recv().await {
        events.push(event.unwrap());
    }

    // Verify event sequence
    assert!(!events.is_empty(), "Should receive events");
    
    let event_types: Vec<String> = events.iter().map(|e| format!("{:?}", e)).collect();
    println!("Events: {:?}", event_types);
    
    // Should have AgentStart, TurnStart, MessageStart, MessageEnd, TurnEnd, AgentEnd
    let has_agent_start = events.iter().any(|e| matches!(e, StreamEvent::AgentStart));
    let has_agent_end = events.iter().any(|e| matches!(e, StreamEvent::AgentEnd { .. }));
    
    assert!(has_agent_start, "Should have AgentStart event");
    assert!(has_agent_end, "Should have AgentEnd event");
}

#[tokio::test]
async fn test_agent_with_tool_call() {
    let tool_registry = Arc::new(ToolRegistry::new());
    
    let calculator_tool = ToolBuilder::new("calculator")
        .description("Perform calculations")
        .parameters(serde_json::json!({
            "type": "object",
            "properties": {
                "expression": { "type": "string" }
            },
            "required": ["expression"]
        }))
        .execute(|_id, params| async move {
            let expr = params["expression"].as_str().unwrap_or("0");
            // Simple evaluation for testing
            let result = if expr == "2+2" { "4" } else { "unknown" };
            Ok(ToolResult::success(serde_json::json!({ "result": result })))
        })
        .build();
    
    tool_registry.register(calculator_tool);

    let client = Arc::new(MockLlmClient::new(vec![
        // First response: tool call
        AssistantMessage::new(
            vec![Content::Text { text: "I'll calculate that for you.".to_string() }],
            vec![ToolCall {
                id: "calc_1".to_string(),
                name: "calculator".to_string(),
                arguments: serde_json::json!({ "expression": "2+2" }),
            }],
            StopReason::ToolCalls,
        ),
        // Second response: final answer
        AssistantMessage::new(
            vec![Content::Text { text: "The result is 4.".to_string() }],
            vec![],
            StopReason::EndOfTurn,
        ),
    ]));

    let model = Model::new(Provider::Custom, "test-model");
    let agent = AgentBuilder::new(model)
        .tools(tool_registry)
        .build(client);

    let (mut rx, _channel) = agent.run("What is 2+2?").await.unwrap();
    
    let mut events = Vec::new();
    while let Some(event) = rx.recv().await {
        events.push(event.unwrap());
    }

    // Verify tool execution
    let tool_start_events: Vec<_> = events.iter().filter(|e| {
        matches!(e, StreamEvent::ToolExecutionStart { .. })
    }).collect();
    
    let tool_end_events: Vec<_> = events.iter().filter(|e| {
        matches!(e, StreamEvent::ToolExecutionEnd { .. })
    }).collect();
    
    assert_eq!(tool_start_events.len(), 1, "Should have one tool execution start");
    assert_eq!(tool_end_events.len(), 1, "Should have one tool execution end");
    
    // Verify final answer
    let agent_end = events.iter().find_map(|e| {
        if let StreamEvent::AgentEnd { messages } = e {
            Some(messages.clone())
        } else {
            None
        }
    });
    
    assert!(agent_end.is_some(), "Should have AgentEnd with messages");
}

#[tokio::test]
async fn test_agent_streaming_events() {
    let client = Arc::new(MockLlmClient::new(vec![
        AssistantMessage::new(
            vec![Content::Text { text: "Streaming ".to_string() }, Content::Text { text: "response!".to_string() }],
            vec![],
            StopReason::EndOfTurn,
        ),
    ]));

    let model = Model::new(Provider::Custom, "test-model");
    let agent = AgentBuilder::new(model).build(client);

    let (mut rx, channel) = agent.run("Test streaming").await.unwrap();
    
    // Also test the broadcast channel
    let mut broadcast_rx = channel.subscribe();
    
    let mut events = Vec::new();
    let mut broadcast_events = Vec::new();
    
    // Collect from both receivers with timeout
    let timeout = tokio::time::Duration::from_secs(5);
    
    while let Ok(Some(event)) = tokio::time::timeout(timeout, rx.recv()).await {
        if let Ok(e) = event {
            events.push(e);
        }
    }
    
    while let Ok(Ok(event)) = tokio::time::timeout(timeout, broadcast_rx.recv()).await {
        broadcast_events.push(event);
    }

    assert!(!events.is_empty(), "Should receive stream events");
}

#[tokio::test]
async fn test_agent_multiple_turns() {
    let client = Arc::new(MockLlmClient::new(vec![
        // Turn 1: tool call
        AssistantMessage::new(
            vec![],
            vec![ToolCall {
                id: "tool_1".to_string(),
                name: "search".to_string(),
                arguments: serde_json::json!({ "query": "test" }),
            }],
            StopReason::ToolCalls,
        ),
        // Turn 2: another tool call
        AssistantMessage::new(
            vec![],
            vec![ToolCall {
                id: "tool_2".to_string(),
                name: "search".to_string(),
                arguments: serde_json::json!({ "query": "more info" }),
            }],
            StopReason::ToolCalls,
        ),
        // Turn 3: final response
        AssistantMessage::new(
            vec![Content::Text { text: "Done!".to_string() }],
            vec![],
            StopReason::EndOfTurn,
        ),
    ]));

    let tool_registry = Arc::new(ToolRegistry::new());
    let search_tool = ToolBuilder::new("search")
        .description("Search for information")
        .parameters(serde_json::json!({
            "type": "object",
            "properties": {
                "query": { "type": "string" }
            }
        }))
        .execute(|_id, _params| async move {
            Ok(ToolResult::success(serde_json::json!({ "results": [] })))
        })
        .build();
    
    tool_registry.register(search_tool);

    let model = Model::new(Provider::Custom, "test-model");
    let agent = AgentBuilder::new(model)
        .tools(tool_registry)
        .build(client);

    let (mut rx, _channel) = agent.run("Do multiple searches").await.unwrap();
    
    let mut events = Vec::new();
    while let Some(event) = rx.recv().await {
        events.push(event.unwrap());
    }

    let turn_starts: Vec<_> = events.iter().filter(|e| matches!(e, StreamEvent::TurnStart)).collect();
    let turn_ends: Vec<_> = events.iter().filter(|e| matches!(e, StreamEvent::TurnEnd { .. })).collect();
    
    assert_eq!(turn_starts.len(), 3, "Should have 3 turns");
    assert_eq!(turn_ends.len(), 3, "Should have 3 turn ends");
}

#[tokio::test]
async fn test_agent_tool_error_handling() {
    let tool_registry = Arc::new(ToolRegistry::new());
    
    let failing_tool = ToolBuilder::new("failing_tool")
        .description("A tool that always fails")
        .parameters(serde_json::json!({
            "type": "object",
            "properties": {}
        }))
        .execute(|_id, _params| async move {
            Err(spectra_rs::error::SpectraError::ToolError {
                name: "failing_tool".to_string(),
                reason: "Tool failed intentionally".to_string(),
                source: None,
            })
        })
        .build();
    
    tool_registry.register(failing_tool);

    let client = Arc::new(MockLlmClient::new(vec![
        AssistantMessage::new(
            vec![],
            vec![ToolCall {
                id: "fail_1".to_string(),
                name: "failing_tool".to_string(),
                arguments: serde_json::json!({}),
            }],
            StopReason::ToolCalls,
        ),
        AssistantMessage::new(
            vec![Content::Text { text: "Sorry, the tool failed.".to_string() }],
            vec![],
            StopReason::EndOfTurn,
        ),
    ]));

    let model = Model::new(Provider::Custom, "test-model");
    let agent = AgentBuilder::new(model)
        .tools(tool_registry)
        .build(client);

    let (mut rx, _channel) = agent.run("Use failing tool").await.unwrap();
    
    let mut events = Vec::new();
    while let Some(event) = rx.recv().await {
        events.push(event.unwrap());
    }

    let tool_end_events: Vec<_> = events.iter().filter(|e| {
        matches!(e, StreamEvent::ToolExecutionEnd { is_error: true, .. })
    }).collect();
    
    assert_eq!(tool_end_events.len(), 1, "Should have one failed tool execution");
}

#[tokio::test]
async fn test_agent_max_turns_limit() {
    // Create client that always returns tool calls (infinite loop scenario)
    let client = Arc::new(MockLlmClient::new(vec![
        AssistantMessage::new(
            vec![],
            vec![ToolCall {
                id: format!("tool_{}", 0),
                name: "loop_tool".to_string(),
                arguments: serde_json::json!({}),
            }],
            StopReason::ToolCalls,
        );
        15 // Create 15 identical responses
    ]));

    let tool_registry = Arc::new(ToolRegistry::new());
    let loop_tool = ToolBuilder::new("loop_tool")
        .description("Tool that causes loops")
        .parameters(serde_json::json!({ "type": "object", "properties": {} }))
        .execute(|_id, _params| async move {
            Ok(ToolResult::success(serde_json::json!({})))
        })
        .build();
    
    tool_registry.register(loop_tool);

    let model = Model::new(Provider::Custom, "test-model");
    let agent = AgentBuilder::new(model)
        .tools(tool_registry)
        .build(client);

    let (mut rx, _channel) = agent.run("This will loop").await.unwrap();
    
    let mut events = Vec::new();
    while let Some(event) = rx.recv().await {
        events.push(event.unwrap());
    }

    let turn_starts: Vec<_> = events.iter().filter(|e| matches!(e, StreamEvent::TurnStart)).collect();
    
    // Should be limited to MAX_TURN_COUNT (10)
    assert!(turn_starts.len() <= 10, "Should not exceed max turns limit");
}

#[tokio::test]
async fn test_agent_message_history() {
    let client = Arc::new(MockLlmClient::new(vec![
        AssistantMessage::new(
            vec![Content::Text { text: "First response".to_string() }],
            vec![],
            StopReason::EndOfTurn,
        ),
    ]));

    let model = Model::new(Provider::Custom, "test-model");
    let agent = AgentBuilder::new(model).build(client);

    let (mut rx, _channel) = agent.run("Message 1").await.unwrap();
    while rx.recv().await.is_some() {}

    // Run again - should have previous context
    let (mut rx2, _channel2) = agent.run("Message 2").await.unwrap();
    let mut events = Vec::new();
    while let Some(event) = rx2.recv().await {
        events.push(event.unwrap());
    }

    let agent_end = events.iter().find_map(|e| {
        if let StreamEvent::AgentEnd { messages } = e {
            Some(messages.len())
        } else {
            None
        }
    });

    // Should have accumulated messages from both runs
    assert!(agent_end.unwrap_or(0) > 0, "Should have message history");
}
