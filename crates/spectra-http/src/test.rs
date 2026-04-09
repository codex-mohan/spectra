#[cfg(test)]
mod tests {
    use crate::{AnthropicClient, OpenAIClient};
    use spectra_core::llm::{LlmClient, LlmRequest, Model};
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
}