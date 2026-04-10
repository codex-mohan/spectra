use crate::error::Result;
use crate::event::{ContentDelta, EventChannel, StreamEvent};
use crate::llm::{LlmClient, LlmRequest, LlmStreamEvent, Model, ToolDef as LlmToolDef};
use crate::messages::{AssistantMessage, Content, Message, StopReason, ToolCall, ToolResultMessage, UserMessage};
use crate::tool::{ToolRegistry, ToolResult};
use std::sync::Arc;
use tokio::sync::mpsc;
use futures_util::StreamExt;

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
    ) -> Result<(mpsc::Receiver<Result<StreamEvent>>, EventChannel)> {
        let (tx, rx) = mpsc::channel(256);
        let channel = EventChannel::new();
        let channel_clone = channel.clone();

        let messages = vec![Message::User(UserMessage::text(user_input))];
        let messages = Arc::new(messages);

        let client = self.client.clone();
        let config = self.config.clone();

        tokio::spawn(async move {
            if let Err(e) = run_agent_loop(client, config, messages, &tx, &channel_clone).await {
                let _ = tx.send(Err(e)).await;
            }
        });

        Ok((rx, channel))
    }

    pub fn config(&self) -> &AgentConfig {
        &self.config
    }
}

fn emit(
    tx: &mpsc::Sender<Result<StreamEvent>>,
    channel: &EventChannel,
    event: StreamEvent,
) -> Result<()> {
    let _ = channel.emit(event.clone());
    tx.try_send(Ok(event)).map_err(|_| crate::error::SpectraError::StreamError {
        reason: "Receiver dropped".to_string(),
    })?;
    Ok(())
}

async fn run_agent_loop(
    client: Arc<dyn LlmClient>,
    config: AgentConfig,
    initial_messages: Arc<Vec<Message>>,
    tx: &mpsc::Sender<Result<StreamEvent>>,
    channel: &EventChannel,
) -> Result<()> {
    emit(tx, channel, StreamEvent::AgentStart)?;

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

    while turn_count < MAX_TURN_COUNT {
        emit(tx, channel, StreamEvent::TurnStart)?;

        let request = LlmRequest {
            model: config.model.clone(),
            system_prompt: config.system_prompt.clone(),
            messages: all_messages.clone(),
            tools: tools.clone(),
        };

        let stream = match client.stream(request).await {
            Ok(s) => s,
            Err(e) => {
                emit(tx, channel, StreamEvent::Error { message: e.to_string() })?;
                break;
            }
        };

        let mut assistant_msg = AssistantMessage::new(Vec::new(), Vec::new(), StopReason::EndOfTurn);

        emit(tx, channel, StreamEvent::MessageStart {
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
                        apply_delta(&mut assistant_msg, &delta);
                        emit(tx, channel, StreamEvent::MessageUpdate { delta })?;
                    }
                    LlmStreamEvent::Done { message } => {
                        assistant_msg = message;
                        break;
                    }
                    LlmStreamEvent::Error { message } => {
                        emit(tx, channel, StreamEvent::Error { message: message.clone() })?;
                        emit(tx, channel, StreamEvent::MessageEnd {
                            message: assistant_msg.clone(),
                        })?;
                        emit(tx, channel, StreamEvent::AgentEnd {
                            messages: vec![assistant_msg.clone()],
                        })?;
                        return Ok(());
                    }
                },
                Err(e) => {
                    emit(tx, channel, StreamEvent::Error { message: e.to_string() })?;
                    emit(tx, channel, StreamEvent::MessageEnd {
                        message: assistant_msg.clone(),
                    })?;
                    emit(tx, channel, StreamEvent::AgentEnd {
                        messages: vec![assistant_msg.clone()],
                    })?;
                    return Ok(());
                }
            }
        }

        emit(tx, channel, StreamEvent::MessageEnd {
            message: assistant_msg.clone(),
        })?;

        all_messages.push(Message::Assistant(assistant_msg.clone()));

        match assistant_msg.stop_reason {
            StopReason::ToolCalls => {
                let mut tool_results: Vec<ToolResultMessage> = Vec::new();

                for tool_call in &assistant_msg.tool_calls {
                    emit(tx, channel, StreamEvent::ToolExecutionStart {
                        tool_call: tool_call.clone(),
                    })?;

                    let result = dispatch_tool(&config.tools, tool_call).await;
                    let tool_result_msg = match &result {
                        Ok(r) => ToolResultMessage {
                            tool_call_id: tool_call.id.clone(),
                            tool_name: tool_call.name.clone(),
                            content: r.content.clone(),
                            is_error: r.is_error,
                            timestamp: chrono::Utc::now(),
                        },
                        Err(e) => ToolResultMessage::error(
                            tool_call.id.clone(),
                            tool_call.name.clone(),
                            e.to_string(),
                        ),
                    };

                    emit(tx, channel, StreamEvent::ToolExecutionEnd {
                        result: tool_result_msg.clone(),
                        is_error: tool_result_msg.is_error,
                    })?;

                    tool_results.push(tool_result_msg.clone());
                    all_messages.push(Message::ToolResult(tool_result_msg));
                }

                emit(tx, channel, StreamEvent::TurnEnd { tool_results })?;
            }
            StopReason::EndOfTurn | StopReason::MaxTokens => {
                emit(tx, channel, StreamEvent::TurnEnd { tool_results: Vec::new() })?;
                break;
            }
            _ => {
                emit(tx, channel, StreamEvent::TurnEnd { tool_results: Vec::new() })?;
                break;
            }
        }

        turn_count += 1;
    }

    emit(tx, channel, StreamEvent::AgentEnd {
        messages: all_messages.iter().filter_map(|m| {
            if let Message::Assistant(a) = m { Some(a.clone()) } else { None }
        }).collect(),
    })?;

    Ok(())
}

fn apply_delta(msg: &mut AssistantMessage, delta: &ContentDelta) {
    match delta {
        ContentDelta::Text { delta: text } => {
            if let Some(Content::Text { text: last }) = msg.content.last_mut() {
                last.push_str(text);
            } else {
                msg.content.push(Content::Text { text: text.clone() });
            }
        }
        ContentDelta::ToolCallStart { id, name } => {
            msg.tool_calls.push(ToolCall {
                id: id.clone(),
                name: name.clone(),
                arguments: serde_json::Value::Null,
            });
        }
        ContentDelta::ToolCallDelta { id, args_delta } => {
            if let Some(tc) = msg.tool_calls.iter_mut().find(|t| t.id == *id) {
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
        ContentDelta::ToolCallEnd { id: _ } => {}
    }
}

async fn dispatch_tool(
    registry: &ToolRegistry,
    tool_call: &ToolCall,
) -> Result<ToolResult> {
    let tool_id = tool_call.id.clone();
    let name = tool_call.name.clone();

    let args = if let serde_json::Value::String(s) = &tool_call.arguments {
        serde_json::from_str(s).map_err(|e| crate::error::SpectraError::SchemaValidation {
            name: name.clone(),
            detail: format!("Invalid JSON in tool arguments: {}", e),
            source: Some(e),
        })?
    } else {
        tool_call.arguments.clone()
    };

    registry.dispatch(&name, tool_id, args).await
}
