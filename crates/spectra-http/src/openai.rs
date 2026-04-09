use async_trait::async_trait;
use futures_util::StreamExt;
use reqwest::Client;
use serde::Deserialize;
use tokio::sync::mpsc;
use tokio_stream::wrappers::ReceiverStream;
use spectra_core::error::{Result, SpectraError};
use spectra_core::llm::{LlmClient, LlmStream, LlmStreamEvent, LlmRequest, LlmResponse, Provider};
use spectra_core::messages::{AssistantMessage, Content, Message, StopReason, TokenUsage, ToolCall};

const OPENAI_API_URL: &str = "https://api.openai.com/v1/chat/completions";

pub struct OpenAIClient {
    client: Client,
    api_key: Option<String>,
    base_url: Option<String>,
}

impl OpenAIClient {
    pub fn new(api_key: Option<String>) -> Self {
        let client = Client::builder()
            .use_rustls_tls()
            .build()
            .expect("Failed to create HTTP client");
        Self { client, api_key, base_url: None }
    }

    pub fn with_api_key(api_key: impl Into<String>) -> Self {
        Self::new(Some(api_key.into()))
    }

    pub fn with_base_url(mut self, url: impl Into<String>) -> Self {
        self.base_url = Some(url.into());
        self
    }

    fn get_api_key(&self) -> Result<String> {
        self.api_key
            .clone()
            .or_else(|| std::env::var("OPENAI_API_KEY").ok())
            .ok_or_else(|| SpectraError::LlmError {
                provider: "openai".into(),
                message: "OPENAI_API_KEY not set".into(),
                source: None,
            })
    }

    fn build_request_body(&self, request: &LlmRequest) -> Result<String> {
        let mut body = serde_json::Map::new();
        body.insert("model".into(), serde_json::Value::String(request.model.id.clone()));
        body.insert("stream".into(), serde_json::Value::Bool(true));

        let messages: Vec<serde_json::Value> = request.messages.iter().map(|msg| {
            match msg {
                Message::User(u) => serde_json::json!({
                    "role": "user",
                    "content": content_to_json(&u.content),
                }),
                Message::Assistant(a) => serde_json::json!({
                    "role": "assistant",
                    "content": assistant_content_to_json(&a.content, &a.tool_calls),
                }),
                Message::ToolResult(tr) => serde_json::json!({
                    "role": "tool",
                    "tool_call_id": tr.tool_call_id,
                    "content": tr.content.to_string(),
                }),
            }
        }).collect();
        body.insert("messages".into(), serde_json::Value::Array(messages));

        if !request.tools.is_empty() {
            let tools: Vec<serde_json::Value> = request.tools.iter().map(|t| {
                serde_json::json!({
                    "type": "function",
                    "function": {
                        "name": t.name,
                        "description": t.description,
                        "parameters": t.parameters,
                    },
                })
            }).collect();
            body.insert("tools".into(), serde_json::Value::Array(tools));
        }

        if let Some(temp) = request.model.config.temperature {
            body.insert("temperature".into(), serde_json::json!(temp));
        }

        if request.model.config.max_tokens > 0 {
            body.insert("max_tokens".into(), serde_json::json!(request.model.config.max_tokens));
        }

        serde_json::to_string(&body).map_err(|e| e.into())
    }

    pub async fn stream_request(&self, request: LlmRequest) -> Result<LlmStream> {
        let api_key = self.get_api_key()?;
        let body = self.build_request_body(&request)?;
        let (tx, rx) = mpsc::channel(256);
        let client = self.client.clone();
        let url = self.base_url.clone().unwrap_or_else(|| OPENAI_API_URL.to_string());

        tokio::spawn(async move {
            let mut assistant_msg = AssistantMessage::new(Vec::new(), Vec::new(), StopReason::EndOfTurn);
            let mut current_tool: Option<ToolCall> = None;
            let mut in_tool = false;

            let _ = tx.send(Ok(LlmStreamEvent::Start { partial: assistant_msg.clone() })).await;

            let response = match client
                .post(&url)
                .header("content-type", "application/json")
                .header("authorization", format!("Bearer {}", api_key))
                .body(body)
                .send()
                .await
            {
                Ok(r) => r,
                Err(e) => {
                    let _ = tx.send(Err(SpectraError::LlmError {
                        provider: "openai".into(),
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
                    provider: "openai".into(),
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
                                    parse_openai_event(&data, &mut assistant_msg, &mut current_tool, &mut in_tool, &tx).await;
                                }
                                _ => line.push(byte),
                            }
                        }
                    }
                    Err(e) => {
                        let _ = tx.send(Err(SpectraError::LlmError {
                            provider: "openai".into(),
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

fn content_to_json(content: &[Content]) -> serde_json::Value {
    let items: Vec<serde_json::Value> = content.iter().filter_map(|c| {
        match c {
            Content::Text { text } => {
                if text.is_empty() { None } else {
                    Some(serde_json::json!({ "type": "text", "text": text }))
                }
            }
            Content::Image { url, .. } => Some(serde_json::json!({
                "type": "image_url",
                "image_url": { "url": url },
            })),
        }
    }).collect();
    if items.len() == 1 { items.into_iter().next().unwrap() } else { serde_json::json!(items) }
}

fn assistant_content_to_json(content: &[Content], tool_calls: &[ToolCall]) -> serde_json::Value {
    let mut items: Vec<serde_json::Value> = Vec::new();

    for c in content {
        if let Content::Text { text } = c {
            if !text.is_empty() {
                items.push(serde_json::json!({ "type": "text", "text": text }));
            }
        }
    }

    for tc in tool_calls {
        items.push(serde_json::json!({
            "type": "function",
            "id": tc.id,
            "function": {
                "name": tc.name,
                "arguments": tc.arguments.to_string(),
            },
        }));
    }

    if items.len() == 1 { items.into_iter().next().unwrap() } else { serde_json::json!(items) }
}

fn parse_stop_reason(reason: Option<&str>) -> StopReason {
    match reason {
        Some("stop") => StopReason::EndOfTurn,
        Some("length") => StopReason::MaxTokens,
        Some("tool_calls") => StopReason::ToolCalls,
        _ => StopReason::EndOfTurn,
    }
}

#[derive(Deserialize)]
struct OpenAIChunk {
    id: Option<String>,
    choices: Option<Vec<OpenAIChoice>>,
}

#[derive(Deserialize)]
struct OpenAIChoice {
    index: Option<u32>,
    delta: Option<OpenAIDelta>,
    finish_reason: Option<String>,
}

#[derive(Deserialize)]
struct OpenAIDelta {
    role: Option<String>,
    content: Option<String>,
    tool_calls: Option<Vec<OpenAIToolCall>>,
}

#[derive(Deserialize)]
struct OpenAIToolCall {
    index: Option<u32>,
    id: Option<String>,
    #[serde(rename = "type")]
    call_type: Option<String>,
    function: Option<OpenAIFunction>,
}

#[derive(Deserialize)]
struct OpenAIFunction {
    name: Option<String>,
    arguments: Option<String>,
}

async fn parse_openai_event(
    data: &str,
    msg: &mut AssistantMessage,
    current_tool: &mut Option<ToolCall>,
    in_tool: &mut bool,
    tx: &mpsc::Sender<std::result::Result<LlmStreamEvent, SpectraError>>,
) {
    if let Ok(chunk) = serde_json::from_str::<OpenAIChunk>(data) {
        if let Some(choices) = chunk.choices {
            for choice in choices {
                if let Some(delta) = choice.delta {
                    if let Some(content) = delta.content {
                        if !content.is_empty() {
                            msg.content.push(Content::Text { text: content.clone() });
                            let _ = tx.send(Ok(LlmStreamEvent::ContentDelta {
                                delta: spectra_core::event::ContentDelta::Text { delta: content },
                            })).await;
                        }
                    }

                    if let Some(tool_calls) = delta.tool_calls {
                        for tc in tool_calls {
                            if let Some(func) = tc.function {
                                if let Some(name) = func.name {
                                    if !*in_tool || current_tool.is_none() {
                                        *in_tool = true;
                                        *current_tool = Some(ToolCall {
                                            id: tc.id.clone().unwrap_or_default(),
                                            name,
                                            arguments: serde_json::Value::Null,
                                        });
                                        let _ = tx.send(Ok(LlmStreamEvent::ToolCallStart {
                                            id: current_tool.as_ref().unwrap().id.clone(),
                                            name: current_tool.as_ref().unwrap().name.clone(),
                                        })).await;
                                    }
                                }

                                if let Some(args) = func.arguments {
                                    let args_str = args.clone();
                                    if let Some(ref mut tc) = current_tool {
                                        if let serde_json::Value::String(ref mut s) = tc.arguments {
                                            s.push_str(&args_str);
                                        } else {
                                            tc.arguments = serde_json::Value::String(args_str.clone());
                                        }
                                        let _ = tx.send(Ok(LlmStreamEvent::ToolCallDelta {
                                            id: tc.id.clone(),
                                            args_delta: args_str,
                                        })).await;
                                    }
                                }
                            }
                        }
                    }
                }

                if let Some(reason) = choice.finish_reason {
                    msg.stop_reason = parse_stop_reason(Some(&reason));

                    if reason == "tool_calls" && *in_tool {
                        if let Some(tc) = current_tool.take() {
                            msg.tool_calls.push(tc.clone());
                            let _ = tx.send(Ok(LlmStreamEvent::ToolCallEnd { id: tc.id })).await;
                        }
                        *in_tool = false;
                    }
                }
            }
        }
    }
}

#[async_trait]
impl LlmClient for OpenAIClient {
    async fn complete(&self, request: LlmRequest) -> Result<LlmResponse> {
        let mut stream = self.stream(request).await?;
        while let Some(event) = stream.next().await {
            match event? {
                LlmStreamEvent::Done { message } => {
                    let stop = message.stop_reason;
                    return Ok(LlmResponse { message, usage: TokenUsage::default(), stop_reason: stop });
                }
                LlmStreamEvent::Error { message } => {
                    return Err(SpectraError::LlmError { provider: "openai".into(), message, source: None });
                }
                _ => continue,
            }
        }
        Err(SpectraError::LlmError {
            provider: "openai".into(),
            message: "No response from OpenAI".into(),
            source: None,
        })
    }

    async fn stream(&self, request: LlmRequest) -> Result<LlmStream> {
        self.stream_request(request).await
    }

    fn provider(&self) -> Provider {
        Provider::OpenAI
    }
}