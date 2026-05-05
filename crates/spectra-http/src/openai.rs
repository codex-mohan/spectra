use async_trait::async_trait;
use futures_util::StreamExt;
use reqwest::Client;
use serde::Deserialize;
use tokio::sync::mpsc;
use tokio_stream::wrappers::ReceiverStream;
use spectra_rs::error::{Result, SpectraError};
use spectra_rs::event::ContentDelta;
use spectra_rs::llm::{LlmClient, LlmStream, LlmStreamEvent, LlmRequest, LlmResponse, Provider, ToolChoice};
use spectra_rs::messages::{
    AssistantMessage, Content, Message, StopReason, TokenUsage, ToolCall,
};

const OPENAI_API_URL: &str = "https://api.openai.com/v1/chat/completions";
const DEFAULT_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(120);
const CONNECT_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(30);

pub struct OpenAIClient {
    client: Client,
    api_key: Option<String>,
    base_url: Option<String>,
}

impl OpenAIClient {
    pub fn new(api_key: Option<String>) -> Result<Self> {
        let client = Client::builder()
            .use_rustls_tls()
            .timeout(DEFAULT_TIMEOUT)
            .connect_timeout(CONNECT_TIMEOUT)
            .pool_max_idle_per_host(10)
            .build()
            .map_err(|e| SpectraError::LlmError {
                provider: "openai".into(),
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
                provider: "openai".into(),
                message: format!("Failed to create HTTP client: {}", e),
                source: Some(Box::new(e)),
            })?;
        Ok(self)
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
        body.insert(
            "model".into(),
            serde_json::Value::String(request.model.id.clone()),
        );
        body.insert("stream".into(), serde_json::Value::Bool(true));

        if let Some(temp) = request.model.config.temperature {
            body.insert("temperature".into(), serde_json::json!(temp));
        }

        if request.model.config.max_tokens > 0 {
            body.insert(
                "max_tokens".into(),
                serde_json::json!(request.model.config.max_tokens),
            );
        }

        // System prompt as first message
        let mut messages: Vec<serde_json::Value> = Vec::new();
        if let Some(system) = &request.system_prompt {
            messages.push(serde_json::json!({"role": "system", "content": system}));
        }

        for msg in &request.messages {
            match msg {
                Message::User(u) => {
                    messages.push(serde_json::json!({
                        "role": "user",
                        "content": user_content_to_json(&u.content),
                    }));
                }
                Message::Assistant(a) => {
                    messages.push(serde_json::json!({
                        "role": "assistant",
                        "content": assistant_content_to_json(&a.content),
                        "tool_calls": a.tool_calls.iter().map(|tc| serde_json::json!({
                            "id": tc.id,
                            "type": "function",
                            "function": {
                                "name": tc.name,
                                "arguments": tc.arguments.to_string(),
                            }
                        })).collect::<Vec<_>>(),
                    }));
                }
                Message::ToolResult(tr) => {
                    let content = if let serde_json::Value::String(s) = &tr.content {
                        s.clone()
                    } else {
                        tr.content.to_string()
                    };
                    messages.push(serde_json::json!({
                        "role": "tool",
                        "tool_call_id": tr.tool_call_id,
                        "content": content,
                    }));
                }
            }
        }

        body.insert("messages".into(), serde_json::Value::Array(messages));

        if !request.tools.is_empty() {
            let tools: Vec<serde_json::Value> = request
                .tools
                .iter()
                .map(|t| {
                    serde_json::json!({
                        "type": "function",
                        "function": {
                            "name": t.name,
                            "description": t.description,
                            "parameters": t.parameters,
                        },
                    })
                })
                .collect();
            body.insert("tools".into(), serde_json::Value::Array(tools));
        }

        // Tool choice
        if let Some(ref tc) = request.tool_choice {
            match tc {
                ToolChoice::Auto => {
                    body.insert("tool_choice".into(), serde_json::json!("auto"));
                }
                ToolChoice::None => {
                    body.insert("tool_choice".into(), serde_json::json!("none"));
                }
                ToolChoice::Required => {
                    body.insert("tool_choice".into(), serde_json::json!("required"));
                }
                ToolChoice::Specific { name } => {
                    body.insert(
                        "tool_choice".into(),
                        serde_json::json!({
                            "type": "function",
                            "function": { "name": name }
                        }),
                    );
                }
            }
        }

        // Reasoning effort
        if let Some(ref re) = request.reasoning_effort {
            body.insert(
                "reasoning_effort".into(),
                serde_json::to_value(re).unwrap_or_default(),
            );
        }

        serde_json::to_string(&body).map_err(|e| e.into())
    }

    pub async fn stream_request(&self, request: LlmRequest) -> Result<LlmStream> {
        let api_key = self.get_api_key()?;
        let body = self.build_request_body(&request)?;
        let (tx, rx) = mpsc::channel(256);
        let client = self.client.clone();
        let url = self
            .base_url
            .clone()
            .unwrap_or_else(|| OPENAI_API_URL.to_string());

        let model_id = request.model.id.clone();
        let provider_name = "openai".to_string();

        tokio::spawn(async move {
            let mut assistant_msg = AssistantMessage::new(
                Vec::new(),
                Vec::new(),
                StopReason::EndOfTurn,
            );
            assistant_msg.provider = provider_name;
            assistant_msg.model = model_id;
            let mut current_tool: Option<ToolCall> = None;
            let mut in_tool = false;

            let _ = tx
                .send(Ok(LlmStreamEvent::Start {
                    partial: assistant_msg.clone(),
                }))
                .await;

            let response = match client
                .post(&url)
                .header("content-type", "application/json")
                .header("authorization", format!("Bearer {}", api_key))
                .header("HTTP-Referer", "https://github.com/spectra-ai/spectra")
                .header("X-Title", "Spectra AI Agent")
                .body(body)
                .send()
                .await
            {
                Ok(r) => r,
                Err(e) => {
                    let _ = tx
                        .send(Err(SpectraError::LlmError {
                            provider: "openai".into(),
                            message: format!("Request failed: {}", e),
                            source: None,
                        }))
                        .await;
                    return;
                }
            };

            if !response.status().is_success() {
                let status = response.status();
                let body_text = response.text().await.unwrap_or_default();
                let _ = tx
                    .send(Err(SpectraError::LlmError {
                        provider: "openai".into(),
                        message: format!("API error {}: {}", status, body_text),
                        source: None,
                    }))
                    .await;
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
                                    if !s.starts_with("data: ") || s.len() <= 6 {
                                        continue;
                                    }
                                    let data = &s[6..];
                                    if data == "[DONE]" {
                                        break;
                                    }
                                    parse_openai_event(
                                        data,
                                        &mut assistant_msg,
                                        &mut current_tool,
                                        &mut in_tool,
                                        &tx,
                                    )
                                    .await;
                                }
                                _ => line.push(byte),
                            }
                        }
                    }
                    Err(e) => {
                        let _ = tx
                            .send(Err(SpectraError::LlmError {
                                provider: "openai".into(),
                                message: format!("Stream error: {}", e),
                                source: None,
                            }))
                            .await;
                        break;
                    }
                }
            }

            let _ = tx
                .send(Ok(LlmStreamEvent::Done {
                    message: assistant_msg,
                }))
                .await;
        });

        Ok(Box::pin(ReceiverStream::new(rx)))
    }
}

fn user_content_to_json(content: &[Content]) -> serde_json::Value {
    if content.len() == 1
        && let Content::Text { text } = &content[0]
        && !text.is_empty()
    {
        return serde_json::json!(text);
    }
    let items: Vec<serde_json::Value> = content
        .iter()
        .filter_map(|c| match c {
            Content::Text { text } => {
                if text.is_empty() {
                    None
                } else {
                    Some(serde_json::json!({ "type": "text", "text": text }))
                }
            }
            Content::Image { url, .. } => Some(serde_json::json!({
                "type": "image_url",
                "image_url": { "url": url },
            })),
            Content::Thinking { .. } => None,
        })
        .collect();
    if items.len() == 1 {
        items.into_iter().next().unwrap()
    } else {
        serde_json::json!(items)
    }
}

fn assistant_content_to_json(content: &[Content]) -> serde_json::Value {
    let items: Vec<serde_json::Value> = content
        .iter()
        .filter_map(|c| match c {
            Content::Text { text } if !text.is_empty() => {
                Some(serde_json::json!({ "type": "text", "text": text }))
            }
            Content::Thinking { .. } => None,
            _ => None,
        })
        .collect();
    if items.len() == 1 {
        items.into_iter().next().unwrap()
    } else {
        serde_json::json!(items)
    }
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
#[allow(dead_code)]
struct OpenAIChunk {
    id: Option<String>,
    choices: Option<Vec<OpenAIChoice>>,
}

#[derive(Deserialize)]
#[allow(dead_code)]
struct OpenAIChoice {
    index: Option<u32>,
    delta: Option<OpenAIDelta>,
    finish_reason: Option<String>,
}

#[derive(Deserialize)]
#[allow(dead_code)]
struct OpenAIDelta {
    role: Option<String>,
    content: Option<String>,
    tool_calls: Option<Vec<OpenAIToolCall>>,
}

#[derive(Deserialize)]
#[allow(dead_code)]
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
    if let Ok(chunk) = serde_json::from_str::<OpenAIChunk>(data)
        && let Some(choices) = chunk.choices
    {
        for choice in choices {
            // Capture response ID
            if let Some(ref id) = chunk.id {
                msg.response_id = Some(id.clone());
            }

            if let Some(delta) = choice.delta {
                if let Some(content) = delta.content
                    && !content.is_empty()
                {
                    // Check for reasoning content marker
                    msg.content.push(Content::Text {
                        text: content.clone(),
                    });
                    let _ = tx
                        .send(Ok(LlmStreamEvent::ContentDelta {
                            delta: ContentDelta::Text { delta: content },
                        }))
                        .await;
                }

                if let Some(tool_calls) = delta.tool_calls {
                    for tc in tool_calls {
                        if let Some(func) = tc.function {
                            if let Some(name) = func.name
                                && (!*in_tool || current_tool.is_none())
                            {
                                *in_tool = true;
                                let id = tc.id.clone().unwrap_or_default();
                                *current_tool = Some(ToolCall {
                                    id: id.clone(),
                                    name: name.clone(),
                                    arguments: serde_json::Value::Null,
                                    thinking_signature: None,
                                });
                                let _ = tx
                                    .send(Ok(LlmStreamEvent::ContentDelta {
                                        delta: ContentDelta::ToolCallStart { id, name },
                                    }))
                                    .await;
                            }

                            if let Some(args) = func.arguments {
                                let args_str = args.clone();
                                if let Some(tc) = current_tool.as_mut() {
                                    if let serde_json::Value::String(s) = &mut tc.arguments {
                                        s.push_str(&args_str);
                                    } else {
                                        tc.arguments =
                                            serde_json::Value::String(args_str.clone());
                                    }
                                    let _ = tx
                                        .send(Ok(LlmStreamEvent::ContentDelta {
                                            delta: ContentDelta::ToolCallDelta {
                                                id: tc.id.clone(),
                                                args_delta: args_str,
                                            },
                                        }))
                                        .await;
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
                        // Parse accumulated arguments
                        if let serde_json::Value::String(s) = &tc.arguments {
                            if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(s) {
                                if let Some(last) = msg.tool_calls.last_mut() {
                                    last.arguments = parsed;
                                }
                            }
                        }
                        let _ = tx
                            .send(Ok(LlmStreamEvent::ContentDelta {
                                delta: ContentDelta::ToolCallEnd { id: tc.id },
                            }))
                            .await;
                    }
                    *in_tool = false;
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
                    return Ok(LlmResponse {
                        message,
                        usage: TokenUsage::default(),
                        stop_reason: stop,
                    });
                }
                LlmStreamEvent::Error { message } => {
                    return Err(SpectraError::LlmError {
                        provider: "openai".into(),
                        message,
                        source: None,
                    });
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
