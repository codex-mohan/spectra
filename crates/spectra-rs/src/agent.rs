use crate::error::{Result, SpectraError};
use crate::event::{ContentDelta, EventChannel, StreamEvent};
use crate::extension::{AfterToolCallAction, BeforeToolCallAction, ExtensionManager};
use crate::llm::{LlmClient, LlmRequest, LlmStreamEvent, Model, Provider, ReasoningEffort, ToolChoice, ToolDef as LlmToolDef};
use crate::messages::{AssistantMessage, Content, Message, StopReason, ToolCall, ToolResultMessage, UserMessage};
use crate::tool::{Tool, ToolContext, ToolRegistry, ToolResult};
use futures_util::StreamExt;
use std::collections::VecDeque;
use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;
use tokio::sync::{mpsc, watch, Mutex};

pub type TransformFn = Arc<
    dyn Fn(Vec<Message>) -> Pin<Box<dyn Future<Output = Vec<Message>> + Send>> + Send + Sync,
>;

pub type ApiKeyFn = Arc<dyn Fn(&str) -> Option<String> + Send + Sync>;

#[derive(Clone)]
pub struct AgentConfig {
    pub model: Model,
    pub system_prompt: Option<String>,
    pub tools: Arc<ToolRegistry>,
    pub max_turns: Option<usize>,
    pub tool_execution: ToolExecutionMode,
    pub max_retry_delay_ms: u64,
    pub tool_choice: Option<ToolChoice>,
    pub reasoning_effort: Option<ReasoningEffort>,
    pub extensions: Arc<ExtensionManager>,
    pub transform_context: Option<TransformFn>,
    pub get_api_key: Option<ApiKeyFn>,
}

#[derive(Clone, Copy, PartialEq)]
pub enum ToolExecutionMode {
    Sequential,
    Parallel,
}

impl Default for AgentConfig {
    fn default() -> Self {
        Self {
            model: Model::new(Provider::Custom, ""),
            system_prompt: None,
            tools: Arc::new(ToolRegistry::new()),
            max_turns: None,
            tool_execution: ToolExecutionMode::Parallel,
            max_retry_delay_ms: 30_000,
            tool_choice: None,
            reasoning_effort: None,
            extensions: Arc::new(ExtensionManager::new()),
            transform_context: None,
            get_api_key: None,
        }
    }
}

pub struct Agent {
    client: Arc<dyn LlmClient>,
    config: AgentConfig,
    message_store: Arc<Mutex<Vec<Message>>>,
}

#[derive(Clone)]
pub struct AgentBuilder {
    model: Model,
    system_prompt: Option<String>,
    tools: Arc<ToolRegistry>,
    max_turns: Option<usize>,
    tool_execution: ToolExecutionMode,
    max_retry_delay_ms: u64,
    tool_choice: Option<ToolChoice>,
    reasoning_effort: Option<ReasoningEffort>,
    extensions: Option<ExtensionManager>,
    transform_context: Option<TransformFn>,
    get_api_key: Option<ApiKeyFn>,
}

impl AgentBuilder {
    pub fn new(model: Model) -> Self {
        Self {
            model,
            system_prompt: None,
            tools: Arc::new(ToolRegistry::new()),
            max_turns: None,
            tool_execution: ToolExecutionMode::Parallel,
            max_retry_delay_ms: 30_000,
            tool_choice: None,
            reasoning_effort: None,
            extensions: None,
            transform_context: None,
            get_api_key: None,
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

    pub fn max_retry_delay_ms(mut self, delay: u64) -> Self {
        self.max_retry_delay_ms = delay;
        self
    }

    pub fn tool_choice(mut self, choice: ToolChoice) -> Self {
        self.tool_choice = Some(choice);
        self
    }

    pub fn reasoning_effort(mut self, effort: ReasoningEffort) -> Self {
        self.reasoning_effort = Some(effort);
        self
    }

    pub fn extensions(mut self, mgr: ExtensionManager) -> Self {
        self.extensions = Some(mgr);
        self
    }

    pub fn transform_context<F, Fut>(mut self, f: F) -> Self
    where
        F: Fn(Vec<Message>) -> Fut + Send + Sync + 'static,
        Fut: Future<Output = Vec<Message>> + Send + 'static,
    {
        self.transform_context = Some(Arc::new(move |msgs| Box::pin(f(msgs))));
        self
    }

    pub fn get_api_key<F>(mut self, f: F) -> Self
    where
        F: Fn(&str) -> Option<String> + Send + Sync + 'static,
    {
        self.get_api_key = Some(Arc::new(f));
        self
    }

    pub fn build(self, client: Arc<dyn LlmClient>) -> Agent {
        let config = AgentConfig {
            model: self.model,
            system_prompt: self.system_prompt,
            tools: self.tools,
            max_turns: self.max_turns,
            tool_execution: self.tool_execution,
            max_retry_delay_ms: self.max_retry_delay_ms,
            tool_choice: self.tool_choice,
            reasoning_effort: self.reasoning_effort,
            extensions: Arc::new(self.extensions.unwrap_or_default()),
            transform_context: self.transform_context,
            get_api_key: self.get_api_key,
        };
        Agent::new(client, config)
    }
}

impl Agent {
    pub fn new(client: Arc<dyn LlmClient>, config: AgentConfig) -> Self {
        Self {
            client,
            config,
            message_store: Arc::new(Mutex::new(Vec::new())),
        }
    }

    pub async fn run(
        &self,
        user_input: impl Into<String>,
    ) -> Result<(mpsc::Receiver<Result<StreamEvent>>, EventChannel, AgentHandle)> {
        let (tx, rx) = mpsc::channel(256);
        let channel = EventChannel::new();
        let channel_clone = channel.clone();

        let initial_messages = {
            let mut store = self.message_store.lock().await;
            let mut msgs: Vec<Message> = store.drain(..).collect();
            msgs.push(Message::User(UserMessage::text(user_input)));
            msgs
        };

        let (abort_tx, _) = watch::channel(false);
        let (progress_tx, _) = mpsc::unbounded_channel();

        let steering_queue = Arc::new(Mutex::new(VecDeque::<Message>::new()));
        let follow_up_queue = Arc::new(Mutex::new(VecDeque::<Message>::new()));

        let handle = AgentHandle {
            steering_queue: steering_queue.clone(),
            follow_up_queue: follow_up_queue.clone(),
            abort_tx: abort_tx.clone(),
        };

        let client = self.client.clone();
        let config = self.config.clone();
        let message_store = self.message_store.clone();

        tokio::spawn(async move {
            let result = run_agent_loop(
                client,
                config,
                initial_messages,
                &tx,
                &channel_clone,
                steering_queue,
                follow_up_queue,
                abort_tx,
                progress_tx,
            )
            .await;

            match result {
                Ok(final_messages) => {
                    *message_store.lock().await = final_messages;
                }
                Err(e) => {
                    let _ = tx.send(Err(e)).await;
                }
            }
        });

        Ok((rx, channel, handle))
    }

    pub async fn restore_history(&self, messages: Vec<Message>) {
        *self.message_store.lock().await = messages;
    }

    pub async fn reset(&self) {
        self.message_store.lock().await.clear();
    }

    pub fn config(&self) -> &AgentConfig {
        &self.config
    }
}

#[derive(Clone)]
pub struct AgentHandle {
    steering_queue: Arc<Mutex<VecDeque<Message>>>,
    follow_up_queue: Arc<Mutex<VecDeque<Message>>>,
    abort_tx: watch::Sender<bool>,
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

    pub fn abort(&self) {
        let _ = self.abort_tx.send(true);
    }
}

fn emit(
    tx: &mpsc::Sender<Result<StreamEvent>>,
    channel: &EventChannel,
    event: StreamEvent,
) -> Result<()> {
    let _ = channel.emit(event.clone());
    tx.try_send(Ok(event)).map_err(|_| SpectraError::StreamError {
        reason: "Receiver dropped".to_string(),
    })?;
    Ok(())
}

#[allow(clippy::too_many_arguments)]
async fn run_agent_loop(
    client: Arc<dyn LlmClient>,
    config: AgentConfig,
    initial_messages: Vec<Message>,
    tx: &mpsc::Sender<Result<StreamEvent>>,
    channel: &EventChannel,
    steering_queue: Arc<Mutex<VecDeque<Message>>>,
    follow_up_queue: Arc<Mutex<VecDeque<Message>>>,
    abort_tx: watch::Sender<bool>,
    _progress_tx: mpsc::UnboundedSender<ToolResult>,
) -> Result<Vec<Message>> {
    emit(tx, channel, StreamEvent::AgentStart)?;
    config.extensions.on_agent_start();

    let tools: Vec<LlmToolDef> = config
        .tools
        .list()
        .into_iter()
        .map(|t| LlmToolDef {
            name: t.name.clone(),
            description: t.description.clone(),
            parameters: t.parameters,
        })
        .collect();

    let mut all_messages = initial_messages;
    let mut turn_count: usize = 0;
    let abort_rx = abort_tx.subscribe();

    loop {
        // Check abort
        if *abort_rx.borrow() {
            emit(tx, channel, StreamEvent::Error {
                message: "Agent aborted by user".to_string(),
            })?;
            break;
        }

        // Check max_turns limit
        if let Some(max) = config.max_turns
            && turn_count >= max
        {
            break;
        }

        emit(tx, channel, StreamEvent::TurnStart)?;
        config.extensions.on_turn_start();

        // Drain steering queue
        let steering_msgs: Vec<Message> = {
            let mut queue = steering_queue.lock().await;
            queue.drain(..).collect()
        };

        for msg in &steering_msgs {
            emit(tx, channel, StreamEvent::MessageStart { message: msg.clone() })?;
            emit(tx, channel, StreamEvent::MessageEnd { message: msg.clone() })?;
        }
        all_messages.extend(steering_msgs);

        // Apply transform context hook
        let context_messages = if let Some(ref transform) = config.transform_context {
            transform(all_messages.clone()).await
        } else {
            all_messages.clone()
        };

        let mut request = LlmRequest::new(config.model.clone());
        request.system_prompt = config.system_prompt.clone();
        request.messages = context_messages;
        request.tools = tools.clone();
        request.tool_choice = config.tool_choice.clone();
        request.reasoning_effort = config.reasoning_effort;

        // Resolve API key
        if let Some(ref get_key) = config.get_api_key {
            if let Some(_key) = get_key(config.model.provider.as_str()) {
                request = LlmRequest {
                    model: Model {
                        provider: config.model.provider,
                        id: config.model.id.clone(),
                        config: config.model.config.clone(),
                    },
                    system_prompt: request.system_prompt.clone(),
                    messages: request.messages,
                    tools: request.tools,
                    tool_choice: request.tool_choice,
                    reasoning_effort: request.reasoning_effort,
                };
            }
        }

        let assistant_msg = match stream_with_retry(
            client.clone(),
            request,
            tx,
            channel,
            abort_rx.clone(),
            config.max_retry_delay_ms,
        )
        .await
        {
            Ok(msg) => msg,
            Err(e) => {
                emit(tx, channel, StreamEvent::Error {
                    message: e.to_string(),
                })?;
                break;
            }
        };

        all_messages.push(Message::Assistant(assistant_msg.clone()));

        match assistant_msg.stop_reason {
            StopReason::ToolCalls => {
                let mut tool_results: Vec<ToolResultMessage> = Vec::new();

                if config.tool_execution == ToolExecutionMode::Parallel {
                    let results =
                        futures_util::future::join_all(assistant_msg.tool_calls.iter().map(|tc| {
                            dispatch_tool_with_events(
                                &config.tools,
                                tc,
                                tx,
                                channel,
                                abort_rx.clone(),
                                &config.extensions,
                            )
                        }))
                        .await;

                    for result in results {
                        match result {
                            Ok(tr) => {
                                tool_results.push(tr.clone());
                                all_messages.push(Message::ToolResult(tr));
                            }
                            Err(e) => {
                                emit(tx, channel, StreamEvent::Error {
                                    message: e.to_string(),
                                })?;
                            }
                        }
                    }
                } else {
                    for tool_call in &assistant_msg.tool_calls {
                        match dispatch_tool_with_events(
                            &config.tools,
                            tool_call,
                            tx,
                            channel,
                            abort_rx.clone(),
                            &config.extensions,
                        )
                        .await
                        {
                            Ok(tr) => {
                                tool_results.push(tr.clone());
                                all_messages.push(Message::ToolResult(tr));
                            }
                            Err(e) => {
                                emit(tx, channel, StreamEvent::Error {
                                    message: e.to_string(),
                                })?;
                            }
                        }
                    }
                }

                emit(tx, channel, StreamEvent::TurnEnd { tool_results })?;
                config.extensions.on_turn_end();
            }
            StopReason::EndOfTurn | StopReason::MaxTokens => {
                emit(
                    tx,
                    channel,
                    StreamEvent::TurnEnd {
                        tool_results: Vec::new(),
                    },
                )?;
                config.extensions.on_turn_end();

                // Check follow-up queue
                let follow_up_msgs: Vec<Message> = {
                    let mut queue = follow_up_queue.lock().await;
                    queue.drain(..).collect()
                };

                if !follow_up_msgs.is_empty() {
                    for msg in &follow_up_msgs {
                        emit(tx, channel, StreamEvent::MessageStart { message: msg.clone() })?;
                        emit(tx, channel, StreamEvent::MessageEnd { message: msg.clone() })?;
                    }
                    all_messages.extend(follow_up_msgs);
                    turn_count = 0;
                    continue;
                }

                break;
            }
            _ => {
                emit(
                    tx,
                    channel,
                    StreamEvent::TurnEnd {
                        tool_results: Vec::new(),
                    },
                )?;
                config.extensions.on_turn_end();
                break;
            }
        }

        turn_count += 1;
    }

    let final_messages = all_messages.clone();
    emit(tx, channel, StreamEvent::AgentEnd {
        messages: all_messages
            .iter()
            .filter_map(|m| {
                if let Message::Assistant(a) = m {
                    Some(a.clone())
                } else {
                    None
                }
            })
            .collect(),
    })?;
    config.extensions.on_agent_end();

    Ok(final_messages)
}

async fn stream_with_retry(
    client: Arc<dyn LlmClient>,
    request: LlmRequest,
    tx: &mpsc::Sender<Result<StreamEvent>>,
    channel: &EventChannel,
    mut abort_rx: watch::Receiver<bool>,
    max_retry_delay_ms: u64,
) -> Result<AssistantMessage> {
    let max_retries = 3;
    let mut last_error = None;

    for attempt in 0..=max_retries {
        if *abort_rx.borrow() {
            return Err(SpectraError::Aborted);
        }

        match do_stream(client.clone(), request.clone(), tx, channel, &mut abort_rx).await {
            Ok(msg) => return Ok(msg),
            Err(e) => {
                let error_msg = e.to_string();

                if error_msg.contains("400")
                    || error_msg.contains("401")
                    || error_msg.contains("403")
                    || error_msg.contains("404")
                {
                    return Err(e);
                }

                last_error = Some(e);

                if attempt < max_retries {
                    let delay = std::cmp::min(1000 * 2_u64.pow(attempt as u32), max_retry_delay_ms);
                    tokio::time::sleep(tokio::time::Duration::from_millis(delay)).await;
                }
            }
        }
    }

    Err(last_error.unwrap_or_else(|| SpectraError::StreamError {
        reason: "Max retries exceeded".to_string(),
    }))
}

async fn do_stream(
    client: Arc<dyn LlmClient>,
    request: LlmRequest,
    tx: &mpsc::Sender<Result<StreamEvent>>,
    channel: &EventChannel,
    abort_rx: &mut watch::Receiver<bool>,
) -> Result<AssistantMessage> {
    let stream = client.stream(request).await?;

    let mut assistant_msg =
        AssistantMessage::new(Vec::new(), Vec::new(), StopReason::EndOfTurn);

    emit(
        tx,
        channel,
        StreamEvent::MessageStart {
            message: Message::Assistant(assistant_msg.clone()),
        },
    )?;

    tokio::pin!(stream);

    while let Some(event_result) = stream.next().await {
        if *abort_rx.borrow() {
            return Err(SpectraError::Aborted);
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
                    emit(tx, channel, StreamEvent::Error {
                        message: message.clone(),
                    })?;
                    emit(
                        tx,
                        channel,
                        StreamEvent::MessageEnd {
                            message: Message::Assistant(assistant_msg.clone()),
                        },
                    )?;
                    return Err(SpectraError::LlmError {
                        provider: "unknown".to_string(),
                        message,
                        source: None,
                    });
                }
            },
            Err(e) => {
                emit(tx, channel, StreamEvent::Error {
                    message: e.to_string(),
                })?;
                emit(
                    tx,
                    channel,
                    StreamEvent::MessageEnd {
                        message: Message::Assistant(assistant_msg.clone()),
                    },
                )?;
                return Err(e);
            }
        }
    }

    emit(
        tx,
        channel,
        StreamEvent::MessageEnd {
            message: Message::Assistant(assistant_msg.clone()),
        },
    )?;

    Ok(assistant_msg)
}

async fn dispatch_tool_with_events(
    registry: &ToolRegistry,
    tool_call: &ToolCall,
    tx: &mpsc::Sender<Result<StreamEvent>>,
    channel: &EventChannel,
    abort_rx: watch::Receiver<bool>,
    extensions: &ExtensionManager,
) -> Result<ToolResultMessage> {
    emit(
        tx,
        channel,
        StreamEvent::ToolExecutionStart {
            tool_call: tool_call.clone(),
        },
    )?;

    // Parse arguments
    let args = if let serde_json::Value::String(s) = &tool_call.arguments {
        serde_json::from_str(s).map_err(|e| SpectraError::SchemaValidation {
            name: tool_call.name.clone(),
            detail: format!("Invalid JSON in tool arguments: {}", e),
            source: Some(e),
        })?
    } else {
        tool_call.arguments.clone()
    };

    // Build tool context with abort signal and progress channel
    let (progress_tx, mut progress_rx) = mpsc::unbounded_channel();

    // Before tool call hooks (using a minimal context with just id + params)
    let minimal_ctx = ToolContext {
        tool_call_id: tool_call.id.clone(),
        params: args.clone(),
        signal: None,
        progress_tx: None,
    };

    let before_actions = extensions.on_before_tool_call(tool_call, &minimal_ctx);
    let block_action = before_actions.iter().find_map(|a| match a {
        BeforeToolCallAction::Block { reason } => Some(reason.clone()),
        _ => None,
    });

    if let Some(reason) = block_action {
        let err_msg = ToolResultMessage::error(
            tool_call.id.clone(),
            tool_call.name.clone(),
            reason,
        );
        emit(
            tx,
            channel,
            StreamEvent::ToolExecutionEnd {
                result: err_msg.clone(),
                is_error: true,
            },
        )?;
        return Ok(err_msg);
    }

    // Check for Transform action
    let modified_args = before_actions.iter().find_map(|a| {
        if let BeforeToolCallAction::Transform { modified_args } = a {
            Some(modified_args.clone())
        } else {
            None
        }
    });

    let tool_ctx = ToolContext {
        tool_call_id: tool_call.id.clone(),
        params: modified_args.unwrap_or_else(|| args.clone()),
        signal: Some(abort_rx),
        progress_tx: Some(progress_tx),
    };

    // Spawn progress relay
    let tx_progress = tx.clone();
    let channel_progress = channel.clone();
    tokio::spawn(async move {
        while let Some(partial) = progress_rx.recv().await {
            let _ = emit(
                &tx_progress,
                &channel_progress,
                StreamEvent::ToolExecutionUpdate {
                    partial: partial.content,
                },
            );
        }
    });

    let result = registry
        .dispatch(&tool_call.name, tool_ctx)
        .await;

    let after_ctx = ToolContext {
        tool_call_id: tool_call.id.clone(),
        params: args,
        signal: None,
        progress_tx: None,
    };

    let tool_result_msg = match &result {
        Ok(r) => {
            let after_actions = extensions.on_after_tool_call(tool_call, &after_ctx, r);

            let (content, is_error) = after_actions
                .iter()
                .find_map(|a| match a {
                    AfterToolCallAction::Replace { result: r } => Some((r.content.clone(), r.is_error)),
                    _ => None,
                })
                .unwrap_or_else(|| (r.content.clone(), r.is_error));

            ToolResultMessage {
                tool_call_id: tool_call.id.clone(),
                tool_name: tool_call.name.clone(),
                content,
                is_error,
                timestamp: chrono::Utc::now(),
            }
        }
        Err(e) => ToolResultMessage::error(
            tool_call.id.clone(),
            tool_call.name.clone(),
            e.to_string(),
        ),
    };

    let is_error = tool_result_msg.is_error;

    emit(
        tx,
        channel,
        StreamEvent::ToolExecutionEnd {
            result: tool_result_msg.clone(),
            is_error,
        },
    )?;

    result.map(|_| tool_result_msg)
}

fn apply_delta(msg: &mut AssistantMessage, delta: &ContentDelta) {
    match delta {
        ContentDelta::Text { delta: text } => {
            if let Some(Content::Text { text: last }) = msg.content.last_mut() {
                last.push_str(text);
            } else {
                msg.content.push(Content::Text {
                    text: text.clone(),
                });
            }
        }
        ContentDelta::Thinking {
            delta: text,
            signature: sig,
        } => {
            if let Some(Content::Thinking {
                thinking: last,
                signature: last_sig,
                ..
            }) = msg.content.last_mut()
            {
                last.push_str(text);
                if let Some(s) = sig {
                    *last_sig = Some(s.clone());
                }
            } else {
                msg.content.push(Content::Thinking {
                    thinking: text.clone(),
                    signature: sig.clone(),
                    redacted: false,
                });
            }
        }
        ContentDelta::ToolCallStart { id, name } => {
            msg.tool_calls.push(ToolCall {
                id: id.clone(),
                name: name.clone(),
                arguments: serde_json::Value::Null,
                thinking_signature: None,
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
