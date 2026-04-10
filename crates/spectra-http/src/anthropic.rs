use async_trait::async_trait;
use futures_util::StreamExt;
use reqwest::Client;
use serde::Deserialize;
use tokio::sync::mpsc;
use tokio_stream::wrappers::ReceiverStream;
use spectra_core::error::{Result, SpectraError};
use spectra_core::llm::{LlmClient, LlmStream, LlmStreamEvent, LlmRequest, LlmResponse, Provider};
use spectra_core::messages::{AssistantMessage, Content, Message, StopReason, TokenUsage, ToolCall};

const ANTHROPIC_API_URL: &str = "https://api.anthropic.com/v1/messages";

pub struct AnthropicClient {
    client: Client,
    api_key: Option<String>,
    base_url: Option<String>,
}

impl AnthropicClient {
    pub fn new(api_key: Option<String>) -> Result<Self> {
        let client = Client::builder()
            .use_rustls_tls()
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

        let messages: Vec<serde_json::Value> = request.messages.iter().map(|msg| {
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
        body.insert("messages".into(), serde_json::Value::Array(messages));

        if let Some(system) = &request.system_prompt {
            body.insert("system".into(), serde_json::Value::String(system.clone()));
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

        tokio::spawn(async move {
            let mut assistant_msg = AssistantMessage::new(Vec::new(), Vec::new(), StopReason::EndOfTurn);
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
                                    parse_event(&data, &mut assistant_msg, &mut current_tool, &mut in_tool, &tx).await;
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
        }
    }).collect();
    if items.len() == 1 { items.into_iter().next().unwrap() } else { serde_json::json!(items) }
}

fn assistant_content_to_json(content: &[Content], tool_calls: &[ToolCall]) -> serde_json::Value {
    let mut items: Vec<serde_json::Value> = Vec::new();

    for c in content {
        if let &Content::Text { ref text } = c {
            if !text.is_empty() {
                items.push(serde_json::json!({ "type": "text", "text": text }));
            }
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

fn parse_stop_reason(reason: &str) -> StopReason {
    match reason {
        "end_turn" => StopReason::EndOfTurn,
        "max_tokens" => StopReason::MaxTokens,
        "tool_use" => StopReason::ToolCalls,
        _ => StopReason::EndOfTurn,
    }
}

#[derive(Deserialize)]
struct SSEEvent {
    #[serde(rename = "type")]
    event_type: String,
    #[serde(default)]
    index: Option<u32>,
    #[serde(default)]
    delta: Option<serde_json::Value>,
    #[serde(default)]
    content_block: Option<serde_json::Value>,
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
            "content_block_start" => {
                if let Some(block) = event.content_block {
                    if block.get("type").and_then(|t| t.as_str()) == Some("tool_use") {
                        *in_tool = true;
                        let id = block.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string();
                        let name = block.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string();
                        *current_tool = Some(ToolCall {
                            id: id.clone(),
                            name: name.clone(),
                            arguments: serde_json::Value::Null,
                        });
                        let _ = tx.send(Ok(LlmStreamEvent::ContentDelta {
                            delta: spectra_core::event::ContentDelta::ToolCallStart {
                                id,
                                name,
                            },
                        })).await;
                    }
                }
            }
            "content_block_delta" => {
                if let Some(delta) = event.delta {
                    if *in_tool {
                            if let Some(text) = delta.get("partial_json").and_then(|t| t.as_str()) {
                                if let Some(ref mut tc) = current_tool {
                                    if let serde_json::Value::String(ref mut s) = tc.arguments {
                                        s.push_str(text);
                                    } else {
                                        tc.arguments = serde_json::Value::String(text.to_string());
                                    }
                                    let _ = tx.send(Ok(LlmStreamEvent::ContentDelta {
                                        delta: spectra_core::event::ContentDelta::ToolCallDelta {
                                            id: tc.id.clone(),
                                            args_delta: text.to_string(),
                                        },
                                    })).await;
                                }
                            }
                    } else if let Some(text) = delta.get("text").and_then(|t| t.as_str()) {
                        msg.content.push(Content::Text { text: text.to_string() });
                        let _ = tx.send(Ok(LlmStreamEvent::ContentDelta {
                            delta: spectra_core::event::ContentDelta::Text { delta: text.to_string() },
                        })).await;
                    }
                }
            }
            "content_block_stop" => {
                if *in_tool {
                    if let Some(tc) = current_tool.take() {
                        msg.tool_calls.push(tc.clone());
                        let _ = tx.send(Ok(LlmStreamEvent::ContentDelta {
                            delta: spectra_core::event::ContentDelta::ToolCallEnd {
                                id: tc.id.clone(),
                            },
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