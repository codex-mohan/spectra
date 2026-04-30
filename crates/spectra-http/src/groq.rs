use async_trait::async_trait;
use futures_util::StreamExt;
use reqwest::Client;
use serde::Deserialize;
use tokio::sync::mpsc;
use tokio_stream::wrappers::ReceiverStream;
use spectra_rs::error::{Result, SpectraError};
use spectra_rs::event::ContentDelta;
use spectra_rs::llm::{LlmClient, LlmStream, LlmStreamEvent, LlmRequest, LlmResponse, Provider};
use spectra_rs::messages::{AssistantMessage, Content, Message, StopReason, TokenUsage, ToolCall};

const GROQ_API_URL: &str = "https://api.groq.com/openai/v1/chat/completions";
const DEFAULT_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(120);
const CONNECT_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(30);

pub struct GroqClient {
    client: Client,
    api_key: Option<String>,
    base_url: Option<String>,
}

impl GroqClient {
    pub fn new(api_key: Option<String>) -> Result<Self> {
        let client = Client::builder()
            .use_rustls_tls()
            .timeout(DEFAULT_TIMEOUT)
            .connect_timeout(CONNECT_TIMEOUT)
            .pool_max_idle_per_host(10)
            .build()
            .map_err(|e| SpectraError::LlmError {
                provider: "groq".into(),
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
                provider: "groq".into(),
                message: format!("Failed to create HTTP client: {}", e),
                source: Some(Box::new(e)),
            })?;
        Ok(self)
    }

    fn get_api_key(&self) -> Result<String> {
        self.api_key
            .clone()
            .or_else(|| std::env::var("GROQ_API_KEY").ok())
            .ok_or_else(|| SpectraError::LlmError {
                provider: "groq".into(),
                message: "GROQ_API_KEY not set".into(),
                source: None,
            })
    }

    fn build_request_body(&self, request: &LlmRequest) -> Result<String> {
        let mut body = serde_json::Map::new();
        body.insert("model".into(), serde_json::Value::String(request.model.id.clone()));
        body.insert("stream".into(), serde_json::Value::Bool(true));

        let mut messages: Vec<serde_json::Value> = Vec::new();

        if let Some(system) = &request.system_prompt {
            messages.push(serde_json::json!({"role": "system", "content": system}));
        }

        for msg in &request.messages {
            match msg {
                Message::User(u) => {
                    let text = u.content.iter()
                        .filter_map(|c| if let Content::Text { text } = c { Some(text.as_str()) } else { None })
                        .collect::<Vec<_>>()
                        .join("");
                    messages.push(serde_json::json!({"role": "user", "content": text}));
                },
                Message::Assistant(a) => {
                    if a.tool_calls.is_empty() {
                        let text = a.content.iter()
                            .filter_map(|c| if let Content::Text { text } = c { Some(text.as_str()) } else { None })
                            .collect::<Vec<_>>()
                            .join("");
                        messages.push(serde_json::json!({"role": "assistant", "content": text}));
                    } else {
                        let mut tool_calls = Vec::new();
                        for tc in &a.tool_calls {
                            tool_calls.push(serde_json::json!({
                                "id": tc.id,
                                "type": "function",
                                "function": {
                                    "name": tc.name,
                                    "arguments": tc.arguments.to_string()
                                }
                            }));
                        }
                        messages.push(serde_json::json!({
                            "role": "assistant",
                            "content": null,
                            "tool_calls": tool_calls
                        }));
                    }
                },
                Message::ToolResult(tr) => {
                    let content = if let serde_json::Value::String(s) = &tr.content {
                        s.clone()
                    } else {
                        tr.content.to_string()
                    };
                    messages.push(serde_json::json!({
                        "role": "tool",
                        "tool_call_id": tr.tool_call_id,
                        "content": content
                    }));
                },
            }
        }

        body.insert("messages".into(), serde_json::Value::Array(messages));

        if !request.tools.is_empty() {
            let tools: Vec<serde_json::Value> = request.tools.iter().map(|t| {
                serde_json::json!({
                    "type": "function",
                    "function": {
                        "name": t.name,
                        "description": t.description,
                        "parameters": t.parameters,
                    }
                })
            }).collect();
            body.insert("tools".into(), serde_json::Value::Array(tools));
        }

        serde_json::to_string(&body).map_err(SpectraError::Serialization)
    }

    pub async fn stream_request(&self, request: LlmRequest) -> Result<LlmStream> {
        let api_key = self.get_api_key()?;
        let url = self.base_url.clone().unwrap_or_else(|| GROQ_API_URL.to_string());
        let body = self.build_request_body(&request)?;
        let (tx, rx) = mpsc::channel(256);

        let client = self.client.clone();

        tokio::spawn(async move {
            let mut assistant_msg = AssistantMessage::new(Vec::new(), Vec::new(), StopReason::EndOfTurn);
            let mut current_tool_calls: Vec<ToolCall> = Vec::new();
            let mut tool_call_args: Vec<String> = Vec::new();

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
                    let _ = tx.send(Err(SpectraError::StreamError {
                        reason: format!("Request failed: {}", e),
                    })).await;
                    return;
                }
            };

            if !response.status().is_success() {
                let status = response.status().as_u16();
                let error_text = response.text().await.unwrap_or_default();
                let _ = tx.send(Err(SpectraError::LlmError {
                    provider: "groq".into(),
                    message: format!("API error {}: {}", status, error_text),
                    source: None,
                })).await;
                return;
            }

            let mut stream = response.bytes_stream();
            let mut buffer = String::new();

            while let Some(chunk) = stream.next().await {
                match chunk {
                    Ok(bytes) => {
                        buffer.push_str(&String::from_utf8_lossy(&bytes));
                        
                        while let Some(pos) = buffer.find('\n') {
                            let line = buffer[..pos].trim().to_string();
                            buffer = buffer[pos + 1..].to_string();
                            
                            if let Some(data) = line.strip_prefix("data: ") {
                                if data == "[DONE]" {
                                    continue;
                                }
                                
                                if let Ok(chunk) = serde_json::from_str::<GroqChunk>(data) {
                                    if let Some(delta) = chunk.choices.first().and_then(|c| c.delta.as_ref()) {
                                        if let Some(content) = &delta.content {
                                            let _ = tx.send(Ok(LlmStreamEvent::ContentDelta {
                                                delta: ContentDelta::Text { delta: content.clone() },
                                            })).await;
                                        }

                                        // Handle tool calls
                                        if let Some(tcs) = &delta.tool_calls {
                                            for tc in tcs {
                                                let idx = tc.index.unwrap_or(0) as usize;
                                                if idx >= current_tool_calls.len() {
                                                    current_tool_calls.push(ToolCall {
                                                        id: tc.id.clone().unwrap_or_default(),
                                                        name: tc.function.as_ref().and_then(|f| f.name.clone()).unwrap_or_default(),
                                                        arguments: serde_json::Value::Null,
                                                    });
                                                    tool_call_args.push(String::new());
                                                }
                                                if let Some(func) = &tc.function {
                                                    if let Some(name) = &func.name {
                                                        current_tool_calls[idx].name = name.clone();
                                                    }
                                                    if let Some(args) = &func.arguments {
                                                        tool_call_args[idx].push_str(args);
                                                    }
                                                }
                                                if let Some(id) = &tc.id {
                                                    current_tool_calls[idx].id = id.clone();
                                                }
                                            }
                                        }
                                    }

                                    if let Some(finish_reason) = chunk.choices.first().and_then(|c| c.finish_reason.as_ref())
                                        && finish_reason == "tool_calls" {
                                            assistant_msg.stop_reason = StopReason::ToolCalls;
                                            for (i, tc) in current_tool_calls.iter_mut().enumerate() {
                                                if let Ok(args) = serde_json::from_str(&tool_call_args[i]) {
                                                    tc.arguments = args;
                                                } else {
                                                    tc.arguments = serde_json::Value::String(tool_call_args[i].clone());
                                                }
                                            }
                                            assistant_msg.tool_calls = current_tool_calls.clone();
                                        }
                                }
                            }
                        }
                    }
                    Err(e) => {
                        let _ = tx.send(Err(SpectraError::StreamError {
                            reason: format!("Stream error: {}", e),
                        })).await;
                        break;
                    }
                }
            }

            let _ = tx.send(Ok(LlmStreamEvent::Done { message: assistant_msg })).await;
        });

        Ok(Box::pin(ReceiverStream::new(rx)))
    }

    pub async fn complete_request(&self, request: LlmRequest) -> Result<LlmResponse> {
        let api_key = self.get_api_key()?;
        let url = self.base_url.clone().unwrap_or_else(|| GROQ_API_URL.to_string());
        let body = self.build_request_body(&request)?;

        let response = self.client
            .post(&url)
            .header("content-type", "application/json")
            .header("authorization", format!("Bearer {}", api_key))
            .body(body)
            .send()
            .await
            .map_err(|e| SpectraError::HttpError {
                status: e.status().map(|s| s.as_u16()).unwrap_or(0),
                url: url.clone(),
            })?;

        if !response.status().is_success() {
            let status = response.status().as_u16();
            let error_text = response.text().await.unwrap_or_default();
            return Err(SpectraError::LlmError {
                provider: "groq".into(),
                message: format!("API error {}: {}", status, error_text),
                source: None,
            });
        }

        let response_text = response.text().await.map_err(|_e| SpectraError::HttpError {
            status: 0,
            url: url.clone(),
        })?;

        #[derive(Deserialize)]
        struct GroqResponse {
            choices: Vec<GroqChoice>,
            usage: Option<GroqUsage>,
        }

        #[derive(Deserialize)]
        struct GroqChoice {
            message: GroqMessage,
            finish_reason: String,
        }

        #[derive(Deserialize)]
        struct GroqMessage {
            content: Option<String>,
            tool_calls: Option<Vec<GroqToolCall>>,
        }

        #[derive(Deserialize)]
        #[allow(dead_code)]
        struct GroqToolCall {
            id: String,
            #[serde(rename = "type")]
            tool_type: String,
            function: GroqFunction,
        }

        #[derive(Deserialize)]
        struct GroqFunction {
            name: String,
            arguments: String,
        }

        #[derive(Deserialize)]
        struct GroqUsage {
            prompt_tokens: u32,
            completion_tokens: u32,
        }

        let groq_response: GroqResponse = serde_json::from_str(&response_text)
            .map_err(SpectraError::Serialization)?;

        let choice = groq_response.choices.into_iter().next()
            .ok_or_else(|| SpectraError::LlmError {
                provider: "groq".into(),
                message: "No choices in response".into(),
                source: None,
            })?;

        let mut content = Vec::new();
        let mut tool_calls = Vec::new();

        if let Some(text) = choice.message.content {
            content.push(Content::Text { text });
        }

        if let Some(tcs) = choice.message.tool_calls {
            for tc in tcs {
                let args = serde_json::from_str(&tc.function.arguments).unwrap_or(serde_json::Value::String(tc.function.arguments));
                tool_calls.push(ToolCall {
                    id: tc.id,
                    name: tc.function.name,
                    arguments: args,
                });
            }
        }

        let stop_reason = match choice.finish_reason.as_str() {
            "stop" => StopReason::EndOfTurn,
            "max_tokens" => StopReason::MaxTokens,
            "tool_calls" => StopReason::ToolCalls,
            _ => StopReason::EndOfTurn,
        };

        let usage = groq_response.usage.unwrap_or(GroqUsage {
            prompt_tokens: 0,
            completion_tokens: 0,
        });

        Ok(LlmResponse {
            message: AssistantMessage::new(content, tool_calls, stop_reason),
            usage: TokenUsage {
                input_tokens: usage.prompt_tokens,
                output_tokens: usage.completion_tokens,
                cache_read_tokens: None,
                cache_write_tokens: None,
            },
            stop_reason,
        })
    }
}

#[derive(Deserialize)]
struct GroqChunk {
    choices: Vec<GroqChunkChoice>,
}

#[derive(Deserialize)]
struct GroqChunkChoice {
    delta: Option<GroqDelta>,
    finish_reason: Option<String>,
}

#[derive(Deserialize)]
struct GroqDelta {
    content: Option<String>,
    tool_calls: Option<Vec<GroqDeltaToolCall>>,
}

#[derive(Deserialize)]
#[allow(dead_code)]
struct GroqDeltaToolCall {
    index: Option<u32>,
    id: Option<String>,
    #[serde(rename = "type")]
    tool_type: Option<String>,
    function: Option<GroqDeltaFunction>,
}

#[derive(Deserialize)]
struct GroqDeltaFunction {
    name: Option<String>,
    arguments: Option<String>,
}

#[async_trait]
impl LlmClient for GroqClient {
    async fn complete(&self, request: LlmRequest) -> Result<LlmResponse> {
        self.complete_request(request).await
    }

    async fn stream(&self, request: LlmRequest) -> Result<LlmStream> {
        self.stream_request(request).await
    }

    fn provider(&self) -> Provider {
        Provider::Groq
    }
}
