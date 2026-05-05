use std::sync::Arc;
use spectra_rs::{
    agent::AgentBuilder,
    llm::{LlmClient, LlmRequest, LlmResponse, LlmStream, LlmStreamEvent, Model, Provider},
    messages::{AssistantMessage, Content, StopReason, ToolCall},
    tool::{ToolBuilder, ToolContext, ToolRegistry, ToolResult},
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
                    vec![Content::Text {
                        text: "Default response".to_string(),
                    }],
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
                vec![Content::Text {
                    text: "Default response".to_string(),
                }],
                vec![],
                StopReason::EndOfTurn,
            )
        };

        let (tx, rx) = mpsc::channel(10);
        let msg_clone = msg.clone();

        tokio::spawn(async move {
            let _ = tx
                .send(Ok(LlmStreamEvent::Start {
                    partial: AssistantMessage::new(vec![], vec![], StopReason::EndOfTurn),
                }))
                .await;

            for content in &msg_clone.content {
                if let Content::Text { text } = content {
                    let _ = tx
                        .send(Ok(LlmStreamEvent::ContentDelta {
                            delta: ContentDelta::Text { delta: text.clone() },
                        }))
                        .await;
                }
            }

            let _ = tx
                .send(Ok(LlmStreamEvent::Done {
                    message: msg_clone,
                }))
                .await;
        });

        Ok(Box::pin(tokio_stream::wrappers::ReceiverStream::new(rx)))
    }

    fn provider(&self) -> Provider {
        Provider::Custom
    }
}

#[tokio::test]
async fn test_agent_simple_conversation() {
    let client = Arc::new(MockLlmClient::new(vec![AssistantMessage::new(
        vec![Content::Text {
            text: "Hello! How can I help you?".to_string(),
        }],
        vec![],
        StopReason::EndOfTurn,
    )]));

    let model = Model::new(Provider::Custom, "test-model");
    let agent = AgentBuilder::new(model)
        .system_prompt("You are a helpful assistant.")
        .build(client);

    let (mut rx, _channel, _handle) = agent.run("Hi there!").await.unwrap();

    let mut events = Vec::new();
    while let Some(event) = rx.recv().await {
        events.push(event.unwrap());
    }

    assert!(!events.is_empty(), "Should receive events");

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
        .execute(|_ctx: ToolContext| async move {
            let expr = _ctx.params["expression"].as_str().unwrap_or("0");
            let result = if expr == "2+2" { "4" } else { "unknown" };
            Ok(ToolResult::success(serde_json::json!({ "result": result })))
        })
        .build();

    tool_registry.register(calculator_tool);

    let client = Arc::new(MockLlmClient::new(vec![
        // First response: tool call
        AssistantMessage::new(
            vec![Content::Text {
                text: "I'll calculate that for you.".to_string(),
            }],
            vec![ToolCall {
                id: "calc_1".to_string(),
                name: "calculator".to_string(),
                arguments: serde_json::json!({ "expression": "2+2" }),
                thinking_signature: None,
            }],
            StopReason::ToolCalls,
        ),
        // Second response: final answer
        AssistantMessage::new(
            vec![Content::Text {
                text: "The result is 4.".to_string(),
            }],
            vec![],
            StopReason::EndOfTurn,
        ),
    ]));

    let model = Model::new(Provider::Custom, "test-model");
    let agent = AgentBuilder::new(model)
        .tools(tool_registry)
        .build(client);

    let (mut rx, _channel, _handle) = agent.run("What is 2+2?").await.unwrap();

    let mut events = Vec::new();
    while let Some(event) = rx.recv().await {
        events.push(event.unwrap());
    }

    let tool_start_events: Vec<_> = events
        .iter()
        .filter(|e| matches!(e, StreamEvent::ToolExecutionStart { .. }))
        .collect();

    let tool_end_events: Vec<_> = events
        .iter()
        .filter(|e| matches!(e, StreamEvent::ToolExecutionEnd { .. }))
        .collect();

    assert_eq!(
        tool_start_events.len(),
        1,
        "Should have one tool execution start"
    );
    assert_eq!(
        tool_end_events.len(),
        1,
        "Should have one tool execution end"
    );

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
    let client = Arc::new(MockLlmClient::new(vec![AssistantMessage::new(
        vec![
            Content::Text {
                text: "Streaming ".to_string(),
            },
            Content::Text {
                text: "response!".to_string(),
            },
        ],
        vec![],
        StopReason::EndOfTurn,
    )]));

    let model = Model::new(Provider::Custom, "test-model");
    let agent = AgentBuilder::new(model).build(client);

    let (mut rx, channel, _handle) = agent.run("Test streaming").await.unwrap();

    let mut broadcast_rx = channel.subscribe();

    let mut events = Vec::new();
    let mut broadcast_events = Vec::new();

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
                thinking_signature: None,
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
                thinking_signature: None,
            }],
            StopReason::ToolCalls,
        ),
        // Turn 3: final response
        AssistantMessage::new(
            vec![Content::Text {
                text: "Done!".to_string(),
            }],
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
        .execute(|__ctx: ToolContext| async move {
            Ok(ToolResult::success(serde_json::json!({ "results": [] })))
        })
        .build();

    tool_registry.register(search_tool);

    let model = Model::new(Provider::Custom, "test-model");
    let agent = AgentBuilder::new(model)
        .tools(tool_registry)
        .build(client);

    let (mut rx, _channel, _handle) = agent.run("Do multiple searches").await.unwrap();

    let mut events = Vec::new();
    while let Some(event) = rx.recv().await {
        events.push(event.unwrap());
    }

    let turn_starts: Vec<_> = events
        .iter()
        .filter(|e| matches!(e, StreamEvent::TurnStart))
        .collect();
    let turn_ends: Vec<_> = events
        .iter()
        .filter(|e| matches!(e, StreamEvent::TurnEnd { .. }))
        .collect();

    assert_eq!(turn_starts.len(), 3, "Should have 3 turns");
    assert_eq!(turn_ends.len(), 3, "Should have 3 turn ends");
}

#[tokio::test]
async fn test_agent_tool_error_handling() {
    let tool_registry = Arc::new(ToolRegistry::new());

    let failing_tool = ToolBuilder::new("failing_tool")
        .description("A tool that always fails")
        .parameters(serde_json::json!({ "type": "object", "properties": {} }))
        .execute(|_ctx: ToolContext| async move {
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
                thinking_signature: None,
            }],
            StopReason::ToolCalls,
        ),
        AssistantMessage::new(
            vec![Content::Text {
                text: "Sorry, the tool failed.".to_string(),
            }],
            vec![],
            StopReason::EndOfTurn,
        ),
    ]));

    let model = Model::new(Provider::Custom, "test-model");
    let agent = AgentBuilder::new(model)
        .tools(tool_registry)
        .build(client);

    let (mut rx, _channel, _handle) = agent.run("Use failing tool").await.unwrap();

    let mut events = Vec::new();
    while let Some(event) = rx.recv().await {
        events.push(event.unwrap());
    }

    let tool_end_events: Vec<_> = events
        .iter()
        .filter(|e| matches!(e, StreamEvent::ToolExecutionEnd { is_error: true, .. }))
        .collect();

    assert_eq!(
        tool_end_events.len(),
        1,
        "Should have one failed tool execution"
    );
}

#[tokio::test]
async fn test_agent_max_turns_limit() {
    let client = Arc::new(MockLlmClient::new(
        (0..15)
            .map(|i| {
                AssistantMessage::new(
                    vec![],
                    vec![ToolCall {
                        id: format!("tool_{}", i),
                        name: "loop_tool".to_string(),
                        arguments: serde_json::json!({}),
                        thinking_signature: None,
                    }],
                    StopReason::ToolCalls,
                )
            })
            .collect(),
    ));

    let tool_registry = Arc::new(ToolRegistry::new());
    let loop_tool = ToolBuilder::new("loop_tool")
        .description("Tool that causes loops")
        .parameters(serde_json::json!({ "type": "object", "properties": {} }))
        .execute(|_ctx: ToolContext| async move {
            Ok(ToolResult::success(serde_json::json!({})))
        })
        .build();

    tool_registry.register(loop_tool);

    let model = Model::new(Provider::Custom, "test-model");
    let agent = AgentBuilder::new(model)
        .tools(tool_registry)
        .max_turns(10)
        .build(client);

    let (mut rx, _channel, _handle) = agent.run("This will loop").await.unwrap();

    let mut events = Vec::new();
    while let Some(event) = rx.recv().await {
        events.push(event.unwrap());
    }

    let turn_starts: Vec<_> = events
        .iter()
        .filter(|e| matches!(e, StreamEvent::TurnStart))
        .collect();

    assert!(turn_starts.len() <= 10, "Should not exceed max turns limit");
}

#[tokio::test]
async fn test_agent_message_history() {
    let client = Arc::new(MockLlmClient::new(vec![AssistantMessage::new(
        vec![Content::Text {
            text: "First response".to_string(),
        }],
        vec![],
        StopReason::EndOfTurn,
    )]));

    let model = Model::new(Provider::Custom, "test-model");
    let agent = AgentBuilder::new(model).build(client);

    let (mut rx, _channel, _handle) = agent.run("Message 1").await.unwrap();
    while rx.recv().await.is_some() {}

    // Run again - should have previous context
    let (mut rx2, _channel2, _handle2) = agent.run("Message 2").await.unwrap();
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

    assert!(agent_end.unwrap_or(0) > 0, "Should have message history");
}

#[tokio::test]
async fn test_agent_restore_history() {
    let client = Arc::new(MockLlmClient::new(vec![
        AssistantMessage::new(
            vec![Content::Text {
                text: "Restored response".to_string(),
            }],
            vec![],
            StopReason::EndOfTurn,
        ),
    ]));

    let model = Model::new(Provider::Custom, "test-model");
    let agent = AgentBuilder::new(model).build(client);

    // Restore existing history
    agent
        .restore_history(vec![spectra_rs::messages::Message::User(
            spectra_rs::messages::UserMessage::text("Previous context"),
        )])
        .await;

    let (mut rx, _channel, _handle) = agent.run("New message").await.unwrap();
    let mut events = Vec::new();
    while let Some(event) = rx.recv().await {
        events.push(event.unwrap());
    }

    let agent_end = events.iter().find_map(|e| {
        if let StreamEvent::AgentEnd { messages } = e {
            Some(messages.len())
        } else {
            None
        }
    });

    assert!(agent_end.unwrap_or(0) >= 1, "Should have restored history");
}

#[tokio::test]
async fn test_agent_reset() {
    let client = Arc::new(MockLlmClient::new(vec![
        AssistantMessage::new(
            vec![Content::Text {
                text: "Response after reset".to_string(),
            }],
            vec![],
            StopReason::EndOfTurn,
        ),
    ]));

    let model = Model::new(Provider::Custom, "test-model");
    let agent = AgentBuilder::new(model).build(client);

    // Run first
    let (mut rx, _channel, _handle) = agent.run("First message").await.unwrap();
    while rx.recv().await.is_some() {}

    // Reset state
    agent.reset().await;

    // Run again - should start fresh
    let (mut rx2, _channel2, _handle2) = agent.run("Second message").await.unwrap();
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

    assert!(agent_end.unwrap_or(0) >= 1, "Should have messages after reset");
}

#[tokio::test]
async fn test_agent_with_transform_context() {
    let client = Arc::new(MockLlmClient::new(vec![AssistantMessage::new(
        vec![Content::Text {
            text: "Transformed response".to_string(),
        }],
        vec![],
        StopReason::EndOfTurn,
    )]));

    let model = Model::new(Provider::Custom, "test-model");
    let agent = AgentBuilder::new(model)
        .transform_context(|messages| async move {
            // Strip system message or add metadata
            messages
        })
        .build(client);

    let (mut rx, _channel, _handle) = agent.run("Test transform").await.unwrap();
    let mut events = Vec::new();
    while let Some(event) = rx.recv().await {
        events.push(event.unwrap());
    }

    let has_message_end = events
        .iter()
        .any(|e| matches!(e, StreamEvent::MessageEnd { .. }));
    assert!(has_message_end, "Should complete with MessageEnd");
}
