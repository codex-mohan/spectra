use crate::error::Result;
use crate::event::{ContentDelta, EventChannel, StreamEvent};
use crate::llm::{LlmClient, LlmRequest, LlmStreamEvent, Model, Provider, ToolDef as LlmToolDef};
use crate::messages::{AssistantMessage, Content, Message, StopReason, ToolCall, ToolResultMessage, UserMessage};
use crate::tool::{Tool, ToolRegistry, ToolResult};
use std::sync::Arc;
use tokio::sync::{mpsc, Mutex};
use futures_util::StreamExt;
use std::collections::VecDeque;

#[derive(Clone)]
pub struct AgentConfig {
    pub model: Model,
    pub system_prompt: Option<String>,
    pub tools: Arc<ToolRegistry>,
    pub max_turns: Option<usize>,
    pub tool_execution: ToolExecutionMode,
}

#[derive(Clone, Copy, PartialEq)]
pub enum ToolExecutionMode {
    Sequential,
    Parallel,
}

impl Default for AgentConfig {
    fn default() -> Self {
        Self {
            model: Model::new(Provider::Anthropic, ""),
            system_prompt: None,
            tools: Arc::new(ToolRegistry::new()),
            max_turns: None,
            tool_execution: ToolExecutionMode::Parallel,
        }
    }
}

pub struct Agent {
    client: Arc<dyn LlmClient>,
    config: AgentConfig,
}

pub struct AgentBuilder {
    model: Model,
    system_prompt: Option<String>,
    tools: Arc<ToolRegistry>,
    max_turns: Option<usize>,
    tool_execution: ToolExecutionMode,
}

impl AgentBuilder {
    pub fn new(model: Model) -> Self {
        Self {
            model,
            system_prompt: None,
            tools: Arc::new(ToolRegistry::new()),
            max_turns: None,
            tool_execution: ToolExecutionMode::Parallel,
        }
    }

    pub fn system_prompt(mut self, prompt: impl Into<String>) -> Self {
        self.system_prompt = Some(prompt.into());
        self
    }

    pub fn tools(mut self, registry: Arc<ToolRegistry>) -> Self {
        self.tools = registry;
        self
    }

    pub fn register_tool(mut self, tool: Arc<dyn Tool>) -> Self {
        Arc::make_mut(&mut self.tools).register(tool);
        self
    }

    pub fn max_turns(mut self, max: usize) -> Self {
        self.max_turns = Some(max);
        self
    }

    pub fn tool_execution(mut self, mode: ToolExecutionMode) -> Self {
        self.tool_execution = mode;
        self
    }

    pub fn build(self, client: Arc<dyn LlmClient>) -> Agent {
        let config = AgentConfig {
            model: self.model,
            system_prompt: self.system_prompt,
            tools: self.tools,
            max_turns: self.max_turns,
            tool_execution: self.tool_execution,
        };
        Agent::new(client, config)
    }
}

impl Agent {
    pub fn new(client: Arc<dyn LlmClient>, config: AgentConfig) -> Self {
        Self { client, config }
    }

    pub async fn run(
        &self,
        user_input: impl Into<String>,
    ) -> Result<(mpsc::Receiver<Result<StreamEvent>>, EventChannel, AgentHandle)> {
        let (tx, rx) = mpsc::channel(256);
        let channel = EventChannel::new();
        let channel_clone = channel.clone();

        let messages = vec![Message::User(UserMessage::text(user_input))];
        let messages = Arc::new(Mutex::new(messages));

        let steering_queue = Arc::new(Mutex::new(VecDeque::<Message>::new()));
        let follow_up_queue = Arc::new(Mutex::new(VecDeque::<Message>::new()));
        let abort_flag = Arc::new(Mutex::new(false));

        let handle = AgentHandle {
            steering_queue: steering_queue.clone(),
            follow_up_queue: follow_up_queue.clone(),
            abort_flag: abort_flag.clone(),
        };

        let client = self.client.clone();
        let config = self.config.clone();

        tokio::spawn(async move {
            if let Err(e) = run_agent_loop(
                client, 
                config, 
                messages, 
                &tx, 
                &channel_clone,
                steering_queue,
                follow_up_queue,
                abort_flag,
            ).await {
                let _ = tx.send(Err(e)).await;
            }
        });

        Ok((rx, channel, handle))
    }

    pub fn config(&self) -> &AgentConfig {
        &self.config
    }
}

#[derive(Clone)]
pub struct AgentHandle {
    steering_queue: Arc<Mutex<VecDeque<Message>>>,
    follow_up_queue: Arc<Mutex<VecDeque<Message>>>,
    abort_flag: Arc<Mutex<bool>>,
}

impl AgentHandle {
    pub async fn steer(&self, message: impl Into<String>) {
        let mut queue = self.steering_queue.lock().await;
        queue.push_back(Message::User(UserMessage::text(message)));
    }

    pub async fn follow_up(&self, message: impl Into<String>) {
        let mut queue = self.follow_up_queue.lock().await;
        queue.push_back(Message::User(UserMessage::text(message)));
    }

    pub async fn abort(&self) {
        let mut flag = self.abort_flag.lock().await;
        *flag = true;
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
    initial_messages: Arc<Mutex<Vec<Message>>>,
    tx: &mpsc::Sender<Result<StreamEvent>>,
    channel: &EventChannel,
    steering_queue: Arc<Mutex<VecDeque<Message>>>,
    follow_up_queue: Arc<Mutex<VecDeque<Message>>>,
    abort_flag: Arc<Mutex<bool>>,
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

    let mut all_messages = {
        let msgs = initial_messages.lock().await;
        (*msgs).clone()
    };

    let mut turn_count = 0;

    loop {
        // Check abort flag
        if *abort_flag.lock().await {
            emit(tx, channel, StreamEvent::Error { 
                message: "Agent aborted by user".to_string() 
            })?;
            break;
        }

        // Check max_turns limit only if configured
        if let Some(max) = config.max_turns {
            if turn_count >= max {
                break;
            }
        }

        emit(tx, channel, StreamEvent::TurnStart)?;

        // Check steering queue
        let steering_msgs = {
            let mut queue = steering_queue.lock().await;
            let msgs: Vec<Message> = queue.drain(..).collect();
            msgs
        };

        for msg in steering_msgs {
            emit(tx, channel, StreamEvent::MessageStart { message: msg.clone() })?;
            emit(tx, channel, StreamEvent::MessageEnd { message: msg.clone() })?;
            all_messages.push(msg);
        }

        let request = LlmRequest {
            model: config.model.clone(),
            system_prompt: config.system_prompt.clone(),
            messages: all_messages.clone(),
            tools: tools.clone(),
        };

        let mut assistant_msg = match stream_with_retry(
            client.clone(),
            request,
            tx,
            channel,
            abort_flag.clone(),
        ).await {
            Ok(msg) => msg,
            Err(e) => {
                emit(tx, channel, StreamEvent::Error { message: e.to_string() })?;
                break;
            }
        };

        all_messages.push(Message::Assistant(assistant_msg.clone()));

        match assistant_msg.stop_reason {
            StopReason::ToolCalls => {
                let mut tool_results: Vec<ToolResultMessage> = Vec::new();

                if config.tool_execution == ToolExecutionMode::Parallel {
                    // Execute tools in parallel
                    let futures: Vec<_> = assistant_msg.tool_calls.iter()
                        .map(|tc| dispatch_tool_with_events(&config.tools, tc, tx, channel))
                        .collect();

                    let results = futures_util::future::join_all(futures).await;
                    
                    for result in results {
                        match result {
                            Ok(tr) => {
                                tool_results.push(tr.clone());
                                all_messages.push(Message::ToolResult(tr));
                            }
                            Err(e) => {
                                emit(tx, channel, StreamEvent::Error { message: e.to_string() })?;
                            }
                        }
                    }
                } else {
                    // Execute tools sequentially
                    for tool_call in &assistant_msg.tool_calls {
                        match dispatch_tool_with_events(&config.tools, tool_call, tx, channel).await {
                            Ok(tr) => {
                                tool_results.push(tr.clone());
                                all_messages.push(Message::ToolResult(tr));
                            }
                            Err(e) => {
                                emit(tx, channel, StreamEvent::Error { message: e.to_string() })?;
                            }
                        }
                    }
                }

                emit(tx, channel, StreamEvent::TurnEnd { tool_results })?;
            }
            StopReason::EndOfTurn | StopReason::MaxTokens => {
                emit(tx, channel, StreamEvent::TurnEnd { tool_results: Vec::new() })?;
                
                // Check follow-up queue before ending
                let follow_up_msgs = {
                    let mut queue = follow_up_queue.lock().await;
                    let msgs: Vec<Message> = queue.drain(..).collect();
                    msgs
                };

                if !follow_up_msgs.is_empty() {
                    for msg in follow_up_msgs {
                        emit(tx, channel, StreamEvent::MessageStart { message: msg.clone() })?;
                        emit(tx, channel, StreamEvent::MessageEnd { message: msg.clone() })?;
                        all_messages.push(msg);
                    }
                    turn_count = 0; // Reset turn count for follow-up
                    continue;
                }

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

async fn stream_with_retry(
    client: Arc<dyn LlmClient>,
    request: LlmRequest,
    tx: &mpsc::Sender<Result<StreamEvent>>,
    channel: &EventChannel,
    abort_flag: Arc<Mutex<bool>>,
) -> Result<AssistantMessage> {
    let max_retries = 3;
    let mut last_error = None;

    for attempt in 0..=max_retries {
        // Check abort before each attempt
        if *abort_flag.lock().await {
            return Err(crate::error::SpectraError::Aborted);
        }

        match do_stream(client.clone(), request.clone(), tx, channel, abort_flag.clone()).await {
            Ok(msg) => return Ok(msg),
            Err(e) => {
                let error_msg = e.to_string();
                
                // Don't retry on 4xx errors (client errors)
                if error_msg.contains("400") || 
                   error_msg.contains("401") || 
                   error_msg.contains("403") || 
                   error_msg.contains("404") {
                    return Err(e);
                }

                last_error = Some(e);

                if attempt < max_retries {
                    let delay = std::cmp::min(1000 * 2_u64.pow(attempt), 30000);
                    tokio::time::sleep(tokio::time::Duration::from_millis(delay)).await;
                }
            }
        }
    }

    Err(last_error.unwrap_or_else(|| crate::error::SpectraError::StreamError {
        reason: "Max retries exceeded".to_string(),
    }))
}

async fn do_stream(
    client: Arc<dyn LlmClient>,
    request: LlmRequest,
    tx: &mpsc::Sender<Result<StreamEvent>>,
    channel: &EventChannel,
    abort_flag: Arc<Mutex<bool>>,
) -> Result<AssistantMessage> {
    let stream = client.stream(request).await?;

    let mut assistant_msg = AssistantMessage::new(Vec::new(), Vec::new(), StopReason::EndOfTurn);

    emit(tx, channel, StreamEvent::MessageStart {
        message: Message::Assistant(assistant_msg.clone()),
    })?;

    tokio::pin!(stream);

    while let Some(event_result) = stream.next().await {
        // Check abort flag during streaming
        if *abort_flag.lock().await {
            return Err(crate::error::SpectraError::Aborted);
        }

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
                        message: Message::Assistant(assistant_msg.clone()),
                    })?;
                    return Err(crate::error::SpectraError::LlmError {
                        provider: "unknown".to_string(),
                        message,
                        source: None,
                    });
                }
            },
            Err(e) => {
                emit(tx, channel, StreamEvent::Error { message: e.to_string() })?;
                emit(tx, channel, StreamEvent::MessageEnd {
                    message: Message::Assistant(assistant_msg.clone()),
                })?;
                return Err(e);
            }
        }
    }

    emit(tx, channel, StreamEvent::MessageEnd {
        message: Message::Assistant(assistant_msg.clone()),
    })?;

    Ok(assistant_msg)
}

async fn dispatch_tool_with_events(
    registry: &ToolRegistry,
    tool_call: &ToolCall,
    tx: &mpsc::Sender<Result<StreamEvent>>,
    channel: &EventChannel,
) -> Result<ToolResultMessage> {
    emit(tx, channel, StreamEvent::ToolExecutionStart {
        tool_call: tool_call.clone(),
    })?;

    let result = dispatch_tool(registry, tool_call).await;
    
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

    result.map(|_| tool_result_msg)
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
