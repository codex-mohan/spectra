use async_trait::async_trait;
use futures_util::StreamExt;
use reqwest::Client;
use serde::Deserialize;
use tokio::sync::mpsc;
use tokio_stream::wrappers::ReceiverStream;
use spectra_rs::error::{Result, SpectraError};
use spectra_rs::event::ContentDelta;
use spectra_rs::llm::{LlmClient, LlmStream, LlmStreamEvent, LlmRequest, LlmResponse, Provider};
use spectra_rs::messages::{
    AssistantMessage, Content, Message, StopReason, TokenUsage, ToolCall,
};

const ANTHROPIC_API_URL: &str = "https://api.anthropic.com/v1/messages";
const DEFAULT_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(120);
const CONNECT_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(30);

pub struct AnthropicClient {
    client: Client,
    api_key: Option<String>,
    base_url: Option<String>,
}

impl AnthropicClient {
    pub fn new(api_key: Option<String>) -> Result<Self> {
        let client = Client::builder()
            .use_rustls_tls()
            .timeout(DEFAULT_TIMEOUT)
            .connect_timeout(CONNECT_TIMEOUT)
            .pool_max_idle_per_host(10)
            .build()
            .map_err(|e| SpectraError::LlmError {
                provider: "anthropic".into(),
                message: format!("Failed to create HTTP client: {}", e),
                source: Some(Box::new(e)),
            })?;
        Ok(Self { client, api_key, base_url: None })
    }

    pub fn with_api_key(api_key: impl Into<String>) -> Result<Self> {
        Self::new(Some(api_key.into()))
    }

    pub fn with_base_url(mut self, url: impl Into<String>) -> Self {
        self.base_url = Some(url.into());
        self
    }

    pub fn with_timeout(mut self, timeout: std::time::Duration) -> Result<Self> {
        self.client = Client::builder()
            .use_rustls_tls()
            .timeout(timeout)
            .connect_timeout(CONNECT_TIMEOUT)
            .pool_max_idle_per_host(10)
            .build()
            .map_err(|e| SpectraError::LlmError {
                provider: "anthropic".into(),
                message: format!("Failed to create HTTP client: {}", e),
                source: Some(Box::new(e)),
            })?;
        Ok(self)
    }

    fn get_api_key(&self) -> Result<String> {
        self.api_key
            .clone()
            .or_else(|| std::env::var("ANTHROPIC_API_KEY").ok())
            .ok_or_else(|| SpectraError::LlmError {
                provider: "anthropic".into(),
                message: "ANTHROPIC_API_KEY not set".into(),
                source: None,
            })
    }

    fn build_request_body(&self, request: &LlmRequest) -> Result<String> {
        let mut body = serde_json::Map::new();
        body.insert("model".into(), serde_json::Value::String(request.model.id.clone()));
        body.insert("max_tokens".into(), serde_json::Value::Number(request.model.config.max_tokens.into()));
        body.insert("stream".into(), serde_json::Value::Bool(true));

        if let Some(temp) = request.model.config.temperature {
            body.insert("temperature".into(), serde_json::json!(temp));
        }

        let mut messages: Vec<serde_json::Value> = request.messages.iter().map(|msg| {
            match msg {
                Message::User(u) => serde_json::json!({
                    "role": "user",
                    "content": user_content_to_json(&u.content),
                }),
                Message::Assistant(a) => serde_json::json!({
                    "role": "assistant",
                    "content": assistant_content_to_json(&a.content, &a.tool_calls),
                }),
                Message::ToolResult(tr) => serde_json::json!({
                    "role": "user",
                    "content": [{
                        "type": "tool_result",
                        "tool_use_id": tr.tool_call_id,
                        "content": tr.content.to_string(),
                    }],
                }),
            }
        }).collect();

        let cache_control = build_cache_control(&self.base_url);

        // Add cache_control to the last content block of the last user message
        if let Some(ref cc) = cache_control {
            if let Some(last_msg) = messages.last_mut() {
                if last_msg.get("role").and_then(|r| r.as_str()) == Some("user") {
                    if let Some(content) = last_msg.get_mut("content") {
                        add_cache_control_to_last_block(content, cc);
                    }
                }
            }
        }

        body.insert("messages".into(), serde_json::Value::Array(messages));

        if let Some(system) = &request.system_prompt {
            if let Some(ref cc) = cache_control {
                body.insert("system".into(), serde_json::json!([{
                    "type": "text",
                    "text": system,
                    "cache_control": cc
                }]));
            } else {
                body.insert("system".into(), serde_json::Value::String(system.clone()));
            }
        }

        if !request.tools.is_empty() {
            let tools: Vec<serde_json::Value> = request.tools.iter().map(|t| {
                serde_json::json!({
                    "name": t.name,
                    "description": t.description,
                    "input_schema": t.parameters,
                })
            }).collect();
            body.insert("tools".into(), serde_json::Value::Array(tools));
        }

        serde_json::to_string(&body).map_err(|e| e.into())
    }

    pub async fn stream_request(&self, request: LlmRequest) -> Result<LlmStream> {
        let api_key = self.get_api_key()?;
        let body = self.build_request_body(&request)?;
        let (tx, rx) = mpsc::channel(256);
        let client = self.client.clone();
        let url = self.base_url.clone().unwrap_or_else(|| ANTHROPIC_API_URL.to_string());

        let model_id = request.model.id.clone();
        let provider_name = "anthropic".to_string();

        tokio::spawn(async move {
            let mut assistant_msg = AssistantMessage::new(Vec::new(), Vec::new(), StopReason::EndOfTurn);
            assistant_msg.provider = provider_name;
            assistant_msg.model = model_id;
            let mut current_tool: Option<ToolCall> = None;
            let mut in_tool = false;

            let _ = tx.send(Ok(LlmStreamEvent::Start { partial: assistant_msg.clone() })).await;

            let response = match client
                .post(&url)
                .header("content-type", "application/json")
                .header("x-api-key", &api_key)
                .header("anthropic-version", "2023-06-01")
                .header("accept", "text/event-stream")
                .body(body)
                .send()
                .await
            {
                Ok(r) => r,
                Err(e) => {
                    let _ = tx.send(Err(SpectraError::LlmError {
                        provider: "anthropic".into(),
                        message: format!("Request failed: {}", e),
                        source: None,
                    })).await;
                    return;
                }
            };

            if !response.status().is_success() {
                let status = response.status();
                let body_text = response.text().await.unwrap_or_default();
                let _ = tx.send(Err(SpectraError::LlmError {
                    provider: "anthropic".into(),
                    message: format!("API error {}: {}", status, body_text),
                    source: None,
                })).await;
                return;
            }

            let mut stream = response.bytes_stream();
            let mut line = Vec::new();

            while let Some(chunk) = stream.next().await {
                match chunk {
                    Ok(bytes) => {
                        for byte in bytes {
                            match byte {
                                b'\n' | b'\r' if !line.is_empty() => {
                                    let s = String::from_utf8_lossy(&line).trim().to_string();
                                    line.clear();
                                    if !s.starts_with("data: ") || s.len() <= 6 { continue; }
                                    let data = &s[6..];
                                    if data == "[DONE]" { break; }
                                    parse_event(data, &mut assistant_msg, &mut current_tool, &mut in_tool, &tx).await;
                                }
                                _ => line.push(byte),
                            }
                        }
                    }
                    Err(e) => {
                        let _ = tx.send(Err(SpectraError::LlmError {
                            provider: "anthropic".into(),
                            message: format!("Stream error: {}", e),
                            source: None,
                        })).await;
                        break;
                    }
                }
            }

            for tc in &mut assistant_msg.tool_calls {
                if let serde_json::Value::String(s) = &tc.arguments {
                    if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(s) {
                        tc.arguments = parsed;
                    }
                }
            }

            let _ = tx.send(Ok(LlmStreamEvent::Done { message: assistant_msg })).await;
        });

        Ok(Box::pin(ReceiverStream::new(rx)))
    }
}

fn user_content_to_json(content: &[Content]) -> serde_json::Value {
    let items: Vec<serde_json::Value> = content.iter().filter_map(|c| {
        match c {
            Content::Text { text } => {
                if text.is_empty() { None } else {
                    Some(serde_json::json!({ "type": "text", "text": text }))
                }
            }
            Content::Image { url, .. } => Some(serde_json::json!({
                "type": "image",
                "source": { "type": "url", "url": url },
            })),
            Content::Thinking { .. } => None,
        }
    }).collect();
    if items.len() == 1 { items.into_iter().next().unwrap() } else { serde_json::json!(items) }
}

fn assistant_content_to_json(content: &[Content], tool_calls: &[ToolCall]) -> serde_json::Value {
    let mut items: Vec<serde_json::Value> = Vec::with_capacity(content.len() + tool_calls.len());

    for c in content {
        if let Content::Text { text } = c
            && !text.is_empty() {
                items.push(serde_json::json!({ "type": "text", "text": text }));
            }
    }

    for tc in tool_calls {
        items.push(serde_json::json!({
            "type": "tool_use",
            "id": tc.id,
            "name": tc.name,
            "input": tc.arguments,
        }));
    }

    if items.len() == 1 { items.into_iter().next().unwrap() } else { serde_json::json!(items) }
}

fn build_cache_control(base_url: &Option<String>) -> Option<serde_json::Value> {
    let retention = std::env::var("SPECTRA_CACHE_RETENTION").unwrap_or_else(|_| "short".into());
    if retention == "none" {
        return None;
    }
    let is_direct = base_url.as_ref().map_or(true, |u| u.contains("api.anthropic.com"));
    if retention == "long" && is_direct {
        Some(serde_json::json!({ "type": "ephemeral", "ttl": "1h" }))
    } else {
        Some(serde_json::json!({ "type": "ephemeral" }))
    }
}

fn add_cache_control_to_last_block(content: &mut serde_json::Value, cache_control: &serde_json::Value) {
    match content {
        serde_json::Value::Array(blocks) => {
            if let Some(last) = blocks.last_mut() {
                if let Some(obj) = last.as_object_mut() {
                    if obj.get("type").and_then(|t| t.as_str()) == Some("text")
                        || obj.get("type").and_then(|t| t.as_str()) == Some("tool_result")
                    {
                        obj.insert("cache_control".into(), cache_control.clone());
                    }
                }
            }
        }
        serde_json::Value::String(text) => {
            *content = serde_json::json!([{
                "type": "text",
                "text": text,
                "cache_control": cache_control
            }]);
        }
        _ => {}
    }
}

fn parse_stop_reason(reason: &str) -> StopReason {
    match reason {
        "end_turn" => StopReason::EndOfTurn,
        "max_tokens" => StopReason::MaxTokens,
        "tool_use" => StopReason::ToolCalls,
        _ => StopReason::EndOfTurn,
    }
}

#[derive(Deserialize)]
#[allow(dead_code)]
struct SSEEvent {
    #[serde(rename = "type")]
    event_type: String,
    #[serde(default)]
    index: Option<u32>,
    #[serde(default)]
    delta: Option<serde_json::Value>,
    #[serde(default)]
    content_block: Option<serde_json::Value>,
    #[serde(default)]
    message: Option<serde_json::Value>,
}

async fn parse_event(
    data: &str,
    msg: &mut AssistantMessage,
    current_tool: &mut Option<ToolCall>,
    in_tool: &mut bool,
    tx: &mpsc::Sender<std::result::Result<LlmStreamEvent, SpectraError>>,
) {
    if let Ok(event) = serde_json::from_str::<SSEEvent>(data) {
        match event.event_type.as_str() {
            "message_start" => {
                if let Some(msg_data) = &event.message {
                    if let Some(id) = msg_data.get("id").and_then(|v| v.as_str()) {
                        msg.response_id = Some(id.to_string());
                    }
                }
            }
            "content_block_start" => {
                if let Some(block) = event.content_block {
                    match block.get("type").and_then(|t| t.as_str()) {
                        Some("tool_use") => {
                            *in_tool = true;
                            let id = block.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string();
                            let name = block.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string();
                            *current_tool = Some(ToolCall {
                                id: id.clone(),
                                name: name.clone(),
                                arguments: serde_json::Value::Null,
                                thinking_signature: None,
                            });
                            let _ = tx.send(Ok(LlmStreamEvent::ContentDelta {
                                delta: ContentDelta::ToolCallStart { id, name },
                            })).await;
                        }
                        Some("thinking") => {
                            let thinking = block.get("thinking").and_then(|v| v.as_str()).unwrap_or("").to_string();
                            let signature = block.get("signature").and_then(|v| v.as_str()).map(|s| s.to_string());
                            msg.content.push(Content::Thinking {
                                thinking: thinking.clone(),
                                signature: signature.clone(),
                                redacted: false,
                            });
                            let _ = tx.send(Ok(LlmStreamEvent::ContentDelta {
                                delta: ContentDelta::Thinking { delta: thinking, signature },
                            })).await;
                        }
                        _ => {}
                    }
                }
            }
            "content_block_delta" => {
                if let Some(delta) = event.delta {
                    if *in_tool {
                        if let Some(text) = delta.get("partial_json").and_then(|t| t.as_str()) {
                            if let Some(tc) = current_tool.as_mut() {
                                if let serde_json::Value::String(s) = &mut tc.arguments {
                                    s.push_str(text);
                                } else {
                                    tc.arguments = serde_json::Value::String(text.to_string());
                                }
                                let _ = tx.send(Ok(LlmStreamEvent::ContentDelta {
                                    delta: ContentDelta::ToolCallDelta {
                                        id: tc.id.clone(),
                                        args_delta: text.to_string(),
                                    },
                                })).await;
                            }
                        }
                    } else if let Some(text) = delta.get("text").and_then(|t| t.as_str()) {
                        msg.content.push(Content::Text { text: text.to_string() });
                        let _ = tx.send(Ok(LlmStreamEvent::ContentDelta {
                            delta: ContentDelta::Text { delta: text.to_string() },
                        })).await;
                    } else if let Some(thinking_delta) = delta.get("thinking").and_then(|t| t.as_str()) {
                        let sig = delta.get("signature").and_then(|v| v.as_str()).map(|s| s.to_string());
                        msg.content.push(Content::Thinking {
                            thinking: thinking_delta.to_string(),
                            signature: sig.clone(),
                            redacted: false,
                        });
                        let _ = tx.send(Ok(LlmStreamEvent::ContentDelta {
                            delta: ContentDelta::Thinking { delta: thinking_delta.to_string(), signature: sig },
                        })).await;
                    }
                }
            }
            "content_block_stop" => {
                if *in_tool {
                    if let Some(tc) = current_tool.take() {
                        msg.tool_calls.push(tc.clone());
                        let _ = tx.send(Ok(LlmStreamEvent::ContentDelta {
                            delta: ContentDelta::ToolCallEnd { id: tc.id.clone() },
                        })).await;
                    }
                    *in_tool = false;
                }
            }
            "message_delta" => {
                if let Some(delta) = event.delta {
                    if let Some(reason) = delta.get("stop_reason").and_then(|r| r.as_str()) {
                        msg.stop_reason = parse_stop_reason(reason);
                    }
                    if let Some(usage) = delta.get("usage") {
                        msg.usage.input_tokens = usage.get("input_tokens").and_then(|v| v.as_u64()).unwrap_or(0) as u32;
                        msg.usage.output_tokens = usage.get("output_tokens").and_then(|v| v.as_u64()).unwrap_or(0) as u32;
                        msg.usage.cache_read_tokens = usage.get("cache_read_input_tokens").and_then(|v| v.as_u64()).unwrap_or(0) as u32;
                        msg.usage.cache_write_tokens = usage.get("cache_creation_input_tokens").and_then(|v| v.as_u64()).unwrap_or(0) as u32;
                    }
                }
            }
            "message_stop" => {
                for tc in &mut msg.tool_calls {
                    if let serde_json::Value::String(s) = &tc.arguments {
                        if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(s) {
                            tc.arguments = parsed;
                        }
                    }
                }
            }
            _ => {}
        }
    }
}

#[async_trait]
impl LlmClient for AnthropicClient {
    async fn complete(&self, request: LlmRequest) -> Result<LlmResponse> {
        let mut stream = self.stream(request).await?;
        while let Some(event) = stream.next().await {
            match event? {
                LlmStreamEvent::Done { message } => {
                    let stop = message.stop_reason;
                    return Ok(LlmResponse { message, usage: TokenUsage::default(), stop_reason: stop });
                }
                LlmStreamEvent::Error { message } => {
                    return Err(SpectraError::LlmError { provider: "anthropic".into(), message, source: None });
                }
                _ => continue,
            }
        }
        Err(SpectraError::LlmError {
            provider: "anthropic".into(),
            message: "No response from Anthropic".into(),
            source: None,
        })
    }

    async fn stream(&self, request: LlmRequest) -> Result<LlmStream> {
        self.stream_request(request).await
    }

    fn provider(&self) -> Provider {
        Provider::Anthropic
    }
}
