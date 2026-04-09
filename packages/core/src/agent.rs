use crate::error::Result;
use crate::event::{ContentDelta, EventChannel, StreamEvent};
use crate::llm::{LlmClient, LlmRequest, LlmStreamEvent, Model, ToolDef as LlmToolDef};
use crate::messages::{AssistantMessage, Content, Message, StopReason, ToolCall, ToolResultMessage, UserMessage};
use crate::tool::{ToolRegistry, ToolResult};
use std::sync::Arc;
use tokio::sync::mpsc;
use futures_util::StreamExt;
use chrono::Utc;

const MAX_TURN_COUNT: usize = 10;

#[derive(Clone)]
pub struct AgentConfig {
    pub model: Model,
    pub system_prompt: Option<String>,
    pub tools: Arc<ToolRegistry>,
}

impl Default for AgentConfig {
    fn default() -> Self {
        Self {
            model: Model::anthropic("claude-sonnet-4-20250514"),
            system_prompt: None,
            tools: Arc::new(ToolRegistry::new()),
        }
    }
}

pub struct Agent {
    client: Arc<dyn LlmClient>,
    config: AgentConfig,
}

impl Agent {
    pub fn new(client: Arc<dyn LlmClient>, config: AgentConfig) -> Self {
        Self { client, config }
    }

    pub async fn run(
        &self,
        user_input: impl Into<String>,
    ) -> Result<mpsc::Receiver<Result<StreamEvent>>> {
        let (tx, rx) = mpsc::channel(256);

        let messages = vec![Message::User(UserMessage::text(user_input))];
        let messages = Arc::new(messages);

        let client = self.client.clone();
        let config = self.config.clone();
        let tx_for_error = tx.clone();
        let channel = EventChannel::new();

        tokio::spawn(async move {
            if let Err(e) = run_agent_loop(
                client,
                config,
                messages,
                &channel,
                tx,
            ).await {
                let _ = tx_for_error.send(Err(e)).await;
            }
        });

        Ok(rx)
    }

    pub fn config(&self) -> &AgentConfig {
        &self.config
    }
}

async fn run_agent_loop(
    client: Arc<dyn LlmClient>,
    config: AgentConfig,
    initial_messages: Arc<Vec<Message>>,
    channel: &EventChannel,
    tx: mpsc::Sender<Result<StreamEvent>>,
) -> Result<()> {
    channel.emit(StreamEvent::AgentStart)?;

    let tools: Vec<LlmToolDef> = config.tools.list()
        .into_iter()
        .map(|t| LlmToolDef {
            name: t.name.clone(),
            description: t.description.clone(),
            parameters: t.parameters.clone(),
        })
        .collect();

    let mut all_messages = (*initial_messages).clone();
    let mut turn_count = 0;
    let mut final_message: Option<AssistantMessage> = None;

    while turn_count < MAX_TURN_COUNT {
        channel.emit(StreamEvent::TurnStart)?;

        let request = LlmRequest {
            model: config.model.clone(),
            system_prompt: config.system_prompt.clone(),
            messages: all_messages.clone(),
            tools: tools.clone(),
        };

        let stream = match client.stream(request).await {
            Ok(s) => s,
            Err(e) => {
                let _ = tx.send(Ok(StreamEvent::Error { message: e.to_string() })).await;
                break;
            }
        };

        let mut assistant_msg = AssistantMessage::new(Vec::new(), Vec::new(), StopReason::EndOfTurn);
        let mut tool_results: Vec<ToolResultMessage> = Vec::new();

        channel.emit(StreamEvent::MessageStart {
            message: assistant_msg.clone(),
        })?;

        tokio::pin!(stream);

        while let Some(event_result) = stream.next().await {
            match event_result {
                Ok(event) => match event {
                    LlmStreamEvent::Start { partial } => {
                        assistant_msg = partial;
                    }
                    LlmStreamEvent::ContentDelta { delta } => {
                        match &delta {
                            ContentDelta::Text { delta: text } => {
                                assistant_msg.content.push(Content::Text {
                                    text: text.clone()
                                });
                            }
                            ContentDelta::ToolCallStart { id, name } => {
                                assistant_msg.tool_calls.push(ToolCall {
                                    id: id.clone(),
                                    name: name.clone(),
                                    arguments: serde_json::Value::Null,
                                });
                            }
                            ContentDelta::ToolCallDelta { id, args_delta } => {
                                if let Some(tc) = assistant_msg.tool_calls.iter_mut().find(|t| t.id == *id) {
                                    match &mut tc.arguments {
                                        serde_json::Value::Null => {
                                            tc.arguments = serde_json::Value::String(args_delta.clone());
                                        }
                                        serde_json::Value::String(s) => {
                                            s.push_str(args_delta);
                                        }
                                        _ => {}
                                    }
                                }
                            }
                            ContentDelta::ToolCallEnd { .. } => {}
                        }

                        channel.emit(StreamEvent::MessageUpdate { delta: delta.clone() })?;
                    }
                    LlmStreamEvent::ToolCallStart { id, name } => {
                        let tool_call = ToolCall {
                            id: id.clone(),
                            name: name.clone(),
                            arguments: serde_json::Value::Null,
                        };
                        channel.emit(StreamEvent::ToolExecutionStart { tool_call })?;
                    }
                    LlmStreamEvent::ToolCallDelta { id, args_delta } => {
                        channel.emit(StreamEvent::MessageUpdate {
                            delta: ContentDelta::ToolCallDelta {
                                id,
                                args_delta,
                            }
                        })?;
                    }
                    LlmStreamEvent::ToolCallEnd { id } => {
                        channel.emit(StreamEvent::ToolExecutionEnd {
                            result: ToolResultMessage {
                                tool_call_id: id.clone(),
                                tool_name: String::new(),
                                content: serde_json::Value::Null,
                                is_error: false,
                                timestamp: Utc::now(),
                            },
                            is_error: false,
                        })?;
                    }
                    LlmStreamEvent::Done { message } => {
                        assistant_msg = message;
                        break;
                    }
                    LlmStreamEvent::Error { message } => {
                        let _ = tx.send(Ok(StreamEvent::Error { message: message.clone() })).await;
                        channel.emit(StreamEvent::Error { message })?;
                        return Ok(());
                    }
                },
                Err(e) => {
                    let _ = tx.send(Ok(StreamEvent::Error { message: e.to_string() })).await;
                    channel.emit(StreamEvent::Error { message: e.to_string() })?;
                    return Ok(());
                }
            }
        }

        channel.emit(StreamEvent::MessageEnd {
            message: assistant_msg.clone(),
        })?;

        final_message = Some(assistant_msg.clone());
        all_messages.push(Message::Assistant(assistant_msg.clone()));

        match assistant_msg.stop_reason {
            StopReason::ToolCalls => {
                for tool_call in &assistant_msg.tool_calls {
                    let result = dispatch_tool(&config.tools, tool_call).await;
                    let tool_result_msg = match &result {
                        Ok(r) => ToolResultMessage {
                            tool_call_id: tool_call.id.clone(),
                            tool_name: tool_call.name.clone(),
                            content: r.content.clone(),
                            is_error: r.is_error,
                            timestamp: Utc::now(),
                        },
                        Err(e) => ToolResultMessage::error(
                            tool_call.id.clone(),
                            tool_call.name.clone(),
                            e.to_string(),
                        ),
                    };
                    tool_results.push(tool_result_msg.clone());

                    let tool_msg = Message::ToolResult(tool_result_msg);
                    all_messages.push(tool_msg);
                }

                channel.emit(StreamEvent::TurnEnd { tool_results })?;
            }
            StopReason::EndOfTurn | StopReason::MaxTokens => {
                break;
            }
            _ => {
                break;
            }
        }

        turn_count += 1;
    }

    channel.emit(StreamEvent::AgentEnd {
        messages: final_message.map(|m| vec![m]).unwrap_or_default(),
    })?;

    Ok(())
}

async fn dispatch_tool(
    registry: &ToolRegistry,
    tool_call: &ToolCall,
) -> Result<ToolResult> {
    let tool_id = tool_call.id.clone();
    let name = tool_call.name.clone();

    let args = if let serde_json::Value::String(s) = &tool_call.arguments {
        serde_json::from_str(s).unwrap_or(serde_json::Value::Null)
    } else {
        tool_call.arguments.clone()
    };

    registry.dispatch(&name, tool_id, args).await
}
