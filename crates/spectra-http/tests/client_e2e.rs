use spectra_http::{AnthropicClient, OpenAIClient};
use spectra_rs::llm::{LlmClient, LlmRequest, LlmStreamEvent, Model};
use spectra_rs::event::ContentDelta;
use spectra_rs::messages::{Content, StopReason};
use futures_util::StreamExt;
use wiremock::{MockServer, Mock, ResponseTemplate};
use wiremock::matchers::{method, path, header};

#[tokio::test]
async fn test_anthropic_full_conversation_flow() {
    let mock_server = MockServer::start().await;

    Mock::given(method("POST"))
        .and(path("/v1/messages"))
        .and(header("x-api-key", "test-key"))
        .respond_with(ResponseTemplate::new(200).set_body_raw(
            r#"data: {"type":"message_start","message":{"id":"msg_1","role":"assistant"}}
data: {"type":"content_block_start","index":0,"content_block":{"type":"text"}}
data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"I'll"}}
data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":" help"}}
data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":" you"}}
data: {"type":"content_block_stop","index":0}
data: {"type":"message_delta","delta":{"stop_reason":"end_turn"}}
data: {"type":"message_stop"}
"#,
            "text/event-stream",
        ))
        .mount(&mock_server)
        .await;

    let client = AnthropicClient::with_api_key("test-key")
        .unwrap()
        .with_base_url(format!("{}/v1/messages", mock_server.uri()));
    
    let model = Model::anthropic("claude-3-5-sonnet-20241022");
    
    let request = LlmRequest {
        model,
        system_prompt: Some("You are a helpful assistant.".to_string()),
        messages: vec![spectra_rs::messages::Message::User(
            spectra_rs::messages::UserMessage::text("Hello!")
        )],
        tools: vec![],
    };

    // Test complete
    let response = client.complete(request.clone()).await;
    assert!(response.is_ok(), "Complete should succeed");
    
    let resp = response.unwrap();
    let full_text: String = resp.message.content.iter()
        .filter_map(|c| if let spectra_rs::messages::Content::Text { text } = c { Some(text.as_str()) } else { None })
        .collect();
    
    assert_eq!(full_text, "I'll help you", "Should concatenate all text deltas");
    assert_eq!(resp.stop_reason, spectra_rs::messages::StopReason::EndOfTurn);
}

#[tokio::test]
async fn test_openai_full_conversation_flow() {
    let mock_server = MockServer::start().await;

    Mock::given(method("POST"))
        .and(path("/v1/chat/completions"))
        .and(header("authorization", "Bearer test-key"))
        .respond_with(ResponseTemplate::new(200).set_body_raw(
            r#"data: {"id":"chatcmpl-123","choices":[{"delta":{"role":"assistant","content":"Hello"},"finish_reason":null}]}

data: {"id":"chatcmpl-123","choices":[{"delta":{"content":" there"},"finish_reason":null}]}

data: {"id":"chatcmpl-123","choices":[{"delta":{"content":"!"},"finish_reason":"stop"}]}

data: [DONE]
"#,
            "text/event-stream",
        ))
        .mount(&mock_server)
        .await;

    let client = OpenAIClient::with_api_key("test-key")
        .unwrap()
        .with_base_url(format!("{}/v1/chat/completions", mock_server.uri()));
    
    let model = Model::openai("gpt-4o");
    
    let request = LlmRequest {
        model,
        system_prompt: None,
        messages: vec![spectra_rs::messages::Message::User(
            spectra_rs::messages::UserMessage::text("Hi!")
        )],
        tools: vec![],
    };

    let response = client.complete(request).await;
    assert!(response.is_ok(), "Complete should succeed");
    
    let resp = response.unwrap();
    let full_text: String = resp.message.content.iter()
        .filter_map(|c| if let spectra_rs::messages::Content::Text { text } = c { Some(text.as_str()) } else { None })
        .collect();
    
    assert_eq!(full_text, "Hello there!", "Should concatenate all text chunks");
}

#[tokio::test]
async fn test_anthropic_with_tools_full_flow() {
    let mock_server = MockServer::start().await;

    Mock::given(method("POST"))
        .and(path("/v1/messages"))
        .respond_with(ResponseTemplate::new(200).set_body_raw(
            r#"data: {"type":"message_start","message":{"id":"msg_1"}}
data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"tool_123","name":"get_weather"}}
data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{"}}
data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"\"location\":"}}
data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"\"Boston\"}"}}
data: {"type":"content_block_stop","index":0}
data: {"type":"message_delta","delta":{"stop_reason":"tool_use"}}
data: {"type":"message_stop"}
"#,
            "text/event-stream",
        ))
        .mount(&mock_server)
        .await;

    let client = AnthropicClient::with_api_key("test-key")
        .unwrap()
        .with_base_url(format!("{}/v1/messages", mock_server.uri()));
    
    let model = Model::anthropic("claude-3-5-sonnet-20241022");
    
    let request = LlmRequest {
        model,
        system_prompt: None,
        messages: vec![],
        tools: vec![spectra_rs::llm::ToolDef {
            name: "get_weather".to_string(),
            description: "Get weather information".to_string(),
            parameters: serde_json::json!({
                "type": "object",
                "properties": {
                    "location": { "type": "string" }
                }
            }),
        }],
    };

    let response = client.complete(request).await;
    assert!(response.is_ok());
    
    let resp = response.unwrap();
    assert_eq!(resp.stop_reason, spectra_rs::messages::StopReason::ToolCalls);
    assert_eq!(resp.message.tool_calls.len(), 1);
    assert_eq!(resp.message.tool_calls[0].name, "get_weather");
    assert_eq!(resp.message.tool_calls[0].id, "tool_123");
    
    // Verify arguments were parsed correctly (arguments are stored as JSON string)
    let args = &resp.message.tool_calls[0].arguments;
    let args_str = match args {
        serde_json::Value::String(s) => s.clone(),
        other => other.to_string(),
    };
    let parsed: serde_json::Value = serde_json::from_str(&args_str).unwrap();
    let location = parsed.get("location").and_then(|v| v.as_str());
    assert_eq!(location, Some("Boston"));
}

#[tokio::test]
async fn test_openai_with_tools_full_flow() {
    let mock_server = MockServer::start().await;

    Mock::given(method("POST"))
        .and(path("/v1/chat/completions"))
        .respond_with(ResponseTemplate::new(200).set_body_raw(
            r#"data: {"id":"chatcmpl-1","choices":[{"delta":{"role":"assistant","content":null,"tool_calls":[{"index":0,"id":"call_1","function":{"name":"calculate","arguments":""}}]},"finish_reason":null}]}

data: {"id":"chatcmpl-1","choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{"}}]},"finish_reason":null}]}

data: {"id":"chatcmpl-1","choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\"x\": 5"}}]},"finish_reason":null}]}

data: {"id":"chatcmpl-1","choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":", \"y\": 3"}}]},"finish_reason":null}]}

data: {"id":"chatcmpl-1","choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"}"}}]},"finish_reason":"tool_calls"}]}

data: [DONE]
"#,
            "text/event-stream",
        ))
        .mount(&mock_server)
        .await;

    let client = OpenAIClient::with_api_key("test-key")
        .unwrap()
        .with_base_url(format!("{}/v1/chat/completions", mock_server.uri()));
    
    let model = Model::openai("gpt-4o");
    
    let request = LlmRequest {
        model,
        system_prompt: None,
        messages: vec![],
        tools: vec![spectra_rs::llm::ToolDef {
            name: "calculate".to_string(),
            description: "Calculate something".to_string(),
            parameters: serde_json::json!({
                "type": "object",
                "properties": {
                    "x": { "type": "number" },
                    "y": { "type": "number" }
                }
            }),
        }],
    };

    let response = client.complete(request).await;
    assert!(response.is_ok());
    
    let resp = response.unwrap();
    assert_eq!(resp.stop_reason, spectra_rs::messages::StopReason::ToolCalls);
    assert_eq!(resp.message.tool_calls.len(), 1);
    assert_eq!(resp.message.tool_calls[0].name, "calculate");
    
    // Verify arguments were assembled from fragments (arguments are stored as JSON string)
    let args = &resp.message.tool_calls[0].arguments;
    let args_str = match args {
        serde_json::Value::String(s) => s.clone(),
        other => other.to_string(),
    };
    let parsed: serde_json::Value = serde_json::from_str(&args_str).unwrap();
    let x = parsed.get("x").and_then(|v| v.as_i64());
    let y = parsed.get("y").and_then(|v| v.as_i64());
    assert_eq!(x, Some(5));
    assert_eq!(y, Some(3));
}

#[tokio::test]
async fn test_streaming_event_types_anthropic() {
    let mock_server = MockServer::start().await;

    Mock::given(method("POST"))
        .and(path("/v1/messages"))
        .respond_with(ResponseTemplate::new(200).set_body_raw(
            r#"data: {"type":"message_start","message":{"id":"msg_1"}}
data: {"type":"content_block_start","index":0,"content_block":{"type":"text"}}
data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}
data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":" World"}}
data: {"type":"content_block_stop","index":0}
data: {"type":"message_delta","delta":{"stop_reason":"end_turn"}}
data: {"type":"message_stop"}
"#,
            "text/event-stream",
        ))
        .mount(&mock_server)
        .await;

    let client = AnthropicClient::with_api_key("test-key")
        .unwrap()
        .with_base_url(format!("{}/v1/messages", mock_server.uri()));
    
    let model = Model::anthropic("claude-3-5-sonnet-20241022");
    
    let request = LlmRequest {
        model,
        system_prompt: None,
        messages: vec![],
        tools: vec![],
    };

    let mut stream = client.stream(request).await.unwrap();
    
    let mut event_types = Vec::new();
    let mut full_text = String::new();
    
    while let Some(event_result) = stream.next().await {
        match event_result.unwrap() {
            LlmStreamEvent::Start { .. } => event_types.push("Start"),
            LlmStreamEvent::ContentDelta { delta } => {
                event_types.push("ContentDelta");
                if let ContentDelta::Text { delta: text } = delta {
                    full_text.push_str(&text);
                }
            }
            LlmStreamEvent::Done { .. } => event_types.push("Done"),
            LlmStreamEvent::Error { .. } => event_types.push("Error"),
        }
    }
    
    assert!(event_types.contains(&"Start"), "Should have Start event");
    assert!(event_types.contains(&"ContentDelta"), "Should have ContentDelta events");
    assert!(event_types.contains(&"Done"), "Should have Done event");
    assert_eq!(full_text, "Hello World", "Should concatenate text deltas");
}

#[tokio::test]
async fn test_error_handling_anthropic() {
    let mock_server = MockServer::start().await;

    Mock::given(method("POST"))
        .and(path("/v1/messages"))
        .respond_with(ResponseTemplate::new(401)
            .set_body_string(r#"{"type":"error","error":{"type":"authentication_error","message":"Invalid API key"}}"#))
        .mount(&mock_server)
        .await;

    let client = AnthropicClient::with_api_key("invalid-key")
        .unwrap()
        .with_base_url(format!("{}/v1/messages", mock_server.uri()));
    
    let model = Model::anthropic("claude-3-5-sonnet-20241022");
    
    let request = LlmRequest {
        model,
        system_prompt: None,
        messages: vec![],
        tools: vec![],
    };

    let result = client.complete(request).await;
    assert!(result.is_err(), "Should return error for 401");
    
    let err_msg = result.unwrap_err().to_string();
    assert!(err_msg.contains("401") || err_msg.contains("API error"), 
            "Error should contain status code: {}", err_msg);
}

#[tokio::test]
async fn test_error_handling_openai() {
    let mock_server = MockServer::start().await;

    Mock::given(method("POST"))
        .and(path("/v1/chat/completions"))
        .respond_with(ResponseTemplate::new(500)
            .set_body_string(r#"{"error":{"message":"Internal server error","type":"internal_error"}}"#))
        .mount(&mock_server)
        .await;

    let client = OpenAIClient::with_api_key("test-key")
        .unwrap()
        .with_base_url(format!("{}/v1/chat/completions", mock_server.uri()));
    
    let model = Model::openai("gpt-4o");
    
    let request = LlmRequest {
        model,
        system_prompt: None,
        messages: vec![],
        tools: vec![],
    };

    let result = client.complete(request).await;
    assert!(result.is_err(), "Should return error for 500");
}

#[tokio::test]
async fn test_conversation_with_history() {
    let mock_server = MockServer::start().await;

    Mock::given(method("POST"))
        .and(path("/v1/messages"))
        .respond_with(ResponseTemplate::new(200).set_body_raw(
            r#"data: {"type":"message_start","message":{"id":"msg_1"}}
data: {"type":"content_block_start","index":0,"content_block":{"type":"text"}}
data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Response with history"}}
data: {"type":"content_block_stop","index":0}
data: {"type":"message_delta","delta":{"stop_reason":"end_turn"}}
data: {"type":"message_stop"}
"#,
            "text/event-stream",
        ))
        .mount(&mock_server)
        .await;

    let client = AnthropicClient::with_api_key("test-key")
        .unwrap()
        .with_base_url(format!("{}/v1/messages", mock_server.uri()));
    
    let model = Model::anthropic("claude-3-5-sonnet-20241022");
    
    // Simulate conversation with history
    let request = LlmRequest {
        model,
        system_prompt: Some("You are a helpful assistant.".to_string()),
        messages: vec![
            spectra_rs::messages::Message::User(
                spectra_rs::messages::UserMessage::text("What is my name?")
            ),
            spectra_rs::messages::Message::Assistant(
                spectra_rs::messages::AssistantMessage::new(
                    vec![Content::Text { text: "Your name is Alice.".to_string() }],
                    vec![],
                    StopReason::EndOfTurn,
                )
            ),
            spectra_rs::messages::Message::User(
                spectra_rs::messages::UserMessage::text("What did you say my name is?")
            ),
        ],
        tools: vec![],
    };

    let response = client.complete(request).await;
    assert!(response.is_ok());
    
    let resp = response.unwrap();
    let text: String = resp.message.content.iter()
        .filter_map(|c| if let spectra_rs::messages::Content::Text { text } = c { Some(text.as_str()) } else { None })
        .collect();
    
    assert_eq!(text, "Response with history");
}

#[tokio::test]
async fn test_empty_response_handling() {
    let mock_server = MockServer::start().await;

    Mock::given(method("POST"))
        .and(path("/v1/chat/completions"))
        .respond_with(ResponseTemplate::new(200).set_body_raw(
            r#"data: {"id":"chatcmpl-123","choices":[{"delta":{"role":"assistant"},"finish_reason":null}]}

data: {"id":"chatcmpl-123","choices":[{"delta":{},"finish_reason":"stop"}]}

data: [DONE]
"#,
            "text/event-stream",
        ))
        .mount(&mock_server)
        .await;

    let client = OpenAIClient::with_api_key("test-key")
        .unwrap()
        .with_base_url(format!("{}/v1/chat/completions", mock_server.uri()));
    
    let model = Model::openai("gpt-4o");
    
    let request = LlmRequest {
        model,
        system_prompt: None,
        messages: vec![],
        tools: vec![],
    };

    let response = client.complete(request).await;
    assert!(response.is_ok());
    
    let resp = response.unwrap();
    assert!(resp.message.content.is_empty() || 
            resp.message.content.iter().all(|c| {
                if let spectra_rs::messages::Content::Text { text } = c {
                    text.is_empty()
                } else {
                    true
                }
            }));
}

#[tokio::test]
async fn test_multiple_tools_in_single_response() {
    let mock_server = MockServer::start().await;

    Mock::given(method("POST"))
        .and(path("/v1/messages"))
        .respond_with(ResponseTemplate::new(200).set_body_raw(
            r#"data: {"type":"message_start","message":{"id":"msg_1"}}
data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"tool_1","name":"search"}}
data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\"query\":\"test\"}"}}
data: {"type":"content_block_stop","index":0}
data: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"tool_2","name":"calculate"}}
data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\"x\":1,\"y\":2}"}}
data: {"type":"content_block_stop","index":1}
data: {"type":"message_delta","delta":{"stop_reason":"tool_use"}}
data: {"type":"message_stop"}
"#,
            "text/event-stream",
        ))
        .mount(&mock_server)
        .await;

    let client = AnthropicClient::with_api_key("test-key")
        .unwrap()
        .with_base_url(format!("{}/v1/messages", mock_server.uri()));
    
    let model = Model::anthropic("claude-3-5-sonnet-20241022");
    
    let request = LlmRequest {
        model,
        system_prompt: None,
        messages: vec![],
        tools: vec![],
    };

    let response = client.complete(request).await;
    assert!(response.is_ok());
    
    let resp = response.unwrap();
    assert_eq!(resp.message.tool_calls.len(), 2, "Should have 2 tool calls");
    assert_eq!(resp.message.tool_calls[0].name, "search");
    assert_eq!(resp.message.tool_calls[1].name, "calculate");
}
