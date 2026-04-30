#[cfg(test)]
mod tests {
    use crate::{AnthropicClient, OpenAIClient};
    use spectra_rs::llm::{LlmClient, LlmRequest, LlmStreamEvent, Model};
    use spectra_rs::event::ContentDelta;
    use futures_util::StreamExt;
    use wiremock::{MockServer, Mock, ResponseTemplate};
    use wiremock::matchers::{method, path, header};

    #[tokio::test]
    async fn test_anthropic_client_basic_request() {
        let mock_server = MockServer::start().await;

        Mock::given(method("POST"))
            .and(path("/v1/messages"))
            .and(header("x-api-key", "test-key"))
            .respond_with(ResponseTemplate::new(200).set_body_raw(
                r#"data: {"type":"message_start","message":{}}
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

        let response = client.complete(request).await;
        if let Err(e) = &response {
            eprintln!("Anthropic error: {:?}", e);
        }
        assert!(response.is_ok());
    }

    #[tokio::test]
    async fn test_openai_client_basic_request() {
        let mock_server = MockServer::start().await;

        Mock::given(method("POST"))
            .and(path("/v1/chat/completions"))
            .and(header("authorization", "Bearer test-key"))
            .respond_with(ResponseTemplate::new(200).set_body_raw(
                r#"data: {"id":"chatcmpl-123","choices":[{"delta":{"content":"Hello"},"finish_reason":null}]}

data: {"id":"chatcmpl-123","choices":[{"delta":{"content":" World"},"finish_reason":"stop"}]}

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
        if let Err(e) = &response {
            eprintln!("OpenAI error: {:?}", e);
        }
        assert!(response.is_ok());
    }

    #[tokio::test]
    async fn test_anthropic_tool_calls() {
        let mock_server = MockServer::start().await;

        Mock::given(method("POST"))
            .and(path("/v1/messages"))
            .respond_with(ResponseTemplate::new(200).set_body_raw(
                r#"data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"tool_123","name":"get_weather"}}
data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\"location\":"}}
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
            tools: vec![],
        };

        let response = client.complete(request).await;
        if let Err(e) = &response {
            eprintln!("Anthropic tool call error: {:?}", e);
        }
        assert!(response.is_ok());
        let resp = response.unwrap();
        assert!(!resp.message.tool_calls.is_empty());
    }

    #[tokio::test]
    async fn test_anthropic_streaming_deltas() {
        let mock_server = MockServer::start().await;

        Mock::given(method("POST"))
            .and(path("/v1/messages"))
            .and(header("x-api-key", "test-key"))
            .respond_with(ResponseTemplate::new(200).set_body_raw(
                r#"data: {"type":"message_start","message":{}}
data: {"type":"content_block_start","index":0,"content_block":{"type":"text"}}
data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hel"}}
data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"lo "}}
data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"World"}}
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
        let mut text_deltas: Vec<String> = Vec::new();
        let mut got_start = false;
        let mut got_done = false;

        while let Some(event_result) = stream.next().await {
            match event_result.unwrap() {
                LlmStreamEvent::Start { .. } => { got_start = true; }
                LlmStreamEvent::ContentDelta { delta: ContentDelta::Text { delta: text } } => {
                    text_deltas.push(text);
                }
                LlmStreamEvent::Done { message } => {
                    got_done = true;
                    let full_text: String = message.content.iter()
                        .filter_map(|c| if let spectra_rs::messages::Content::Text { text } = c { Some(text.as_str()) } else { None })
                        .collect();
                    assert_eq!(full_text, "Hello World", "Text should be concatenated, not fragmented per chunk");
                }
                _ => {}
            }
        }

        assert!(got_start, "Should receive Start event");
        assert!(got_done, "Should receive Done event");
        assert_eq!(text_deltas, vec!["Hel", "lo ", "World"], "Should receive individual text deltas");
    }

    #[tokio::test]
    async fn test_anthropic_streaming_tool_call_deltas() {
        let mock_server = MockServer::start().await;

        Mock::given(method("POST"))
            .and(path("/v1/messages"))
            .and(header("x-api-key", "test-key"))
            .respond_with(ResponseTemplate::new(200).set_body_raw(
                r#"data: {"type":"message_start","message":{}}
data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"tool_abc","name":"read_file"}}
data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\"pat"}}
data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"h\":\"/tm"}}
data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"p/test\"}"}}
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
            tools: vec![],
        };

        let mut stream = client.stream(request).await.unwrap();
        let mut tool_call_start: Option<(String, String)> = None;
        let mut tool_call_deltas: Vec<String> = Vec::new();
        let mut tool_call_end_id: Option<String> = None;

        while let Some(event_result) = stream.next().await {
            match event_result.unwrap() {
                LlmStreamEvent::ContentDelta { delta } => {
                    match delta {
                        ContentDelta::ToolCallStart { id, name } => {
                            tool_call_start = Some((id, name));
                        }
                        ContentDelta::ToolCallDelta { id: _, args_delta } => {
                            tool_call_deltas.push(args_delta);
                        }
                        ContentDelta::ToolCallEnd { id } => {
                            tool_call_end_id = Some(id);
                        }
                        _ => {}
                    }
                }
                LlmStreamEvent::Done { message } => {
                    assert_eq!(message.tool_calls.len(), 1);
                    let tc = &message.tool_calls[0];
                    assert_eq!(tc.id, "tool_abc");
                    assert_eq!(tc.name, "read_file");
                    let args_str = match &tc.arguments {
                        serde_json::Value::String(s) => s.clone(),
                        other => other.to_string(),
                    };
                    let parsed: serde_json::Value = serde_json::from_str(&args_str).unwrap();
                    assert_eq!(parsed["path"], "/tmp/test");
                }
                _ => {}
            }
        }

        assert_eq!(tool_call_start, Some(("tool_abc".to_string(), "read_file".to_string())),
            "ToolCallStart should fire with id and name");
        assert_eq!(tool_call_deltas, vec!["{\"pat", "h\":\"/tm", "p/test\"}"],
            "ToolCallDelta should stream argument fragments");
        assert_eq!(tool_call_end_id, Some("tool_abc".to_string()),
            "ToolCallEnd should fire with id");
    }

    #[tokio::test]
    async fn test_openai_tool_call_streaming() {
        let mock_server = MockServer::start().await;

        Mock::given(method("POST"))
            .and(path("/v1/chat/completions"))
            .and(header("authorization", "Bearer test-key"))
            .respond_with(ResponseTemplate::new(200).set_body_raw(
                r#"data: {"id":"chatcmpl-1","choices":[{"delta":{"role":"assistant","content":null,"tool_calls":[{"index":0,"id":"call_1","function":{"name":"get_weather","arguments":""}}]},"finish_reason":null}]}

data: {"id":"chatcmpl-1","choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\"lo"}}]},"finish_reason":null}]}

data: {"id":"chatcmpl-1","choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"cation"}}]},"finish_reason":null}]}

data: {"id":"chatcmpl-1","choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\":\"NYC\"}"}}]},"finish_reason":"tool_calls"}]}

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
        assert!(!resp.message.tool_calls.is_empty());
        assert_eq!(resp.message.tool_calls[0].name, "get_weather");
    }

    #[tokio::test]
    async fn test_anthropic_error_handling() {
        let mock_server = MockServer::start().await;

        Mock::given(method("POST"))
            .and(path("/v1/messages"))
            .and(header("x-api-key", "test-key"))
            .respond_with(ResponseTemplate::new(429)
                .set_body_string(r#"{"type":"error","error":{"type":"rate_limit_error","message":"Too many requests"}}"#))
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

        let result = client.complete(request).await;
        assert!(result.is_err(), "Should return error for 429 response");
        let err_msg = result.unwrap_err().to_string();
        assert!(err_msg.contains("429") || err_msg.contains("API error"), "Error should mention status: {}", err_msg);
    }
}