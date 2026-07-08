use crate::error::{Result, SpectraError};
use crate::event::{ContentDelta, EventChannel, StreamEvent};
use crate::extension::{AfterToolCallAction, BeforeToolCallAction, ExtensionManager};
use crate::llm::{
    LlmClient, LlmRequest, LlmStreamEvent, Model, Provider, ReasoningEffort, ToolChoice,
    ToolDef as LlmToolDef,
};
use crate::messages::{
    AssistantMessage, Content, Message, Provenance, StopReason, ToolCall, ToolResultMessage,
    UserMessage,
};
use crate::tool::{Tool, ToolContext, ToolRegistry, ToolResult};
use futures_util::StreamExt;
use std::collections::VecDeque;
use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;
use tokio::sync::{Mutex, mpsc, watch};

pub type TransformFn =
    Arc<dyn Fn(Vec<Message>) -> Pin<Box<dyn Future<Output = Vec<Message>> + Send>> + Send + Sync>;

pub type ConvertToLlmFn =
    Arc<dyn Fn(Vec<Message>) -> Pin<Box<dyn Future<Output = Vec<Message>> + Send>> + Send + Sync>;

pub type ApiKeyFn = Arc<dyn Fn(&str) -> Option<String> + Send + Sync>;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ProvenanceDetailLevel {
    None,
    Hash,
    Redacted,
    Full,
}

#[derive(Clone, Debug)]
pub struct ProvenanceConfig {
    pub enabled: bool,
    pub audit: bool,
    pub message_provenance: bool,
    pub include_args: ProvenanceDetailLevel,
    pub include_context_diff: bool,
}

impl Default for ProvenanceConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            audit: true,
            message_provenance: true,
            include_args: ProvenanceDetailLevel::Hash,
            include_context_diff: false,
        }
    }
}

impl ProvenanceConfig {
    pub fn disabled() -> Self {
        Self {
            enabled: false,
            audit: false,
            message_provenance: false,
            ..Self::default()
        }
    }
}


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
    pub convert_to_llm: Option<ConvertToLlmFn>,
    pub get_api_key: Option<ApiKeyFn>,
    pub provenance: ProvenanceConfig,
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
            convert_to_llm: None,
            get_api_key: None,
            provenance: ProvenanceConfig::default(),
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
    convert_to_llm: Option<ConvertToLlmFn>,
    provenance: ProvenanceConfig,
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
            convert_to_llm: None,
            get_api_key: None,
            provenance: ProvenanceConfig::default(),
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

    pub fn convert_to_llm<F, Fut>(mut self, f: F) -> Self
    where
        F: Fn(Vec<Message>) -> Fut + Send + Sync + 'static,
        Fut: Future<Output = Vec<Message>> + Send + 'static,
    {
        self.convert_to_llm = Some(Arc::new(move |msgs| Box::pin(f(msgs))));
        self
    }

    pub fn get_api_key<F>(mut self, f: F) -> Self
    where
        F: Fn(&str) -> Option<String> + Send + Sync + 'static,
    {
        self.get_api_key = Some(Arc::new(f));
        self
    }

    pub fn provenance(mut self, enabled: bool) -> Self {
        self.provenance = if enabled {
            ProvenanceConfig::default()
        } else {
            ProvenanceConfig::disabled()
        };
        self
    }

    pub fn provenance_config(mut self, config: ProvenanceConfig) -> Self {
        self.provenance = config;
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
            convert_to_llm: self.convert_to_llm,
            get_api_key: self.get_api_key,
            provenance: self.provenance,
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
    ) -> Result<(
        mpsc::Receiver<Result<StreamEvent>>,
        EventChannel,
        AgentHandle,
    )> {
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
    tx.try_send(Ok(event))
        .map_err(|_| SpectraError::StreamError {
            reason: "Receiver dropped".to_string(),
        })?;
    Ok(())
}

fn hash_json<T: serde::Serialize>(value: &T) -> String {
    use std::hash::{Hash, Hasher};
    let text = serde_json::to_string(value).unwrap_or_else(|_| "<unserializable>".to_string());
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    text.hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

fn should_attach_message_provenance(config: &ProvenanceConfig) -> bool {
    config.enabled && config.message_provenance
}

fn emit_audit(
    tx: &mpsc::Sender<Result<StreamEvent>>,
    channel: &EventChannel,
    provenance: &ProvenanceConfig,
    event_type: impl Into<String>,
    details: std::collections::HashMap<String, serde_json::Value>,
) -> Result<()> {
    if !provenance.enabled || !provenance.audit {
        return Ok(());
    }

    emit(
        tx,
        channel,
        StreamEvent::Audit {
            event_type: event_type.into(),
            details,
            timestamp: chrono::Utc::now(),
        },
    )
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
            emit(
                tx,
                channel,
                StreamEvent::Error {
                    message: "Agent aborted by user".to_string(),
                },
            )?;
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
            emit(
                tx,
                channel,
                StreamEvent::MessageStart {
                    message: msg.clone(),
                },
            )?;
            emit(
                tx,
                channel,
                StreamEvent::MessageEnd {
                    message: msg.clone(),
                },
            )?;
        }
        all_messages.extend(steering_msgs);

        // Apply transform context hook
        let context_messages = if let Some(ref transform) = config.transform_context {
            let before_hash = hash_json(&all_messages);
            let before_message_count = all_messages.len();
            let transformed = transform(all_messages.clone()).await;
            let after_hash = hash_json(&transformed);
            let mut details = std::collections::HashMap::new();
            details.insert("hook".to_string(), serde_json::json!("transformContext"));
            details.insert("beforeMessageCount".to_string(), serde_json::json!(before_message_count));
            details.insert("afterMessageCount".to_string(), serde_json::json!(transformed.len()));
            details.insert("beforeHash".to_string(), serde_json::json!(before_hash));
            details.insert("afterHash".to_string(), serde_json::json!(after_hash));
            details.insert(
                "changed".to_string(),
                serde_json::json!(hash_json(&all_messages) != hash_json(&transformed)),
            );
            emit_audit(tx, channel, &config.provenance, "context_transformed", details)?;
            transformed
        } else {
            all_messages.clone()
        };

        // Apply convert_to_llm hook (LLM format conversion)
        let context_messages = if let Some(ref convert) = config.convert_to_llm {
            convert(context_messages).await
        } else {
            context_messages
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
            &config.provenance,
        )
        .await
        {
            Ok(msg) => msg,
            Err(e) => {
                emit(
                    tx,
                    channel,
                    StreamEvent::Error {
                        message: e.to_string(),
                    },
                )?;
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
                                &config.provenance,
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
                                emit(
                                    tx,
                                    channel,
                                    StreamEvent::Error {
                                        message: e.to_string(),
                                    },
                                )?;
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
                            &config.provenance,
                        )
                        .await
                        {
                            Ok(tr) => {
                                tool_results.push(tr.clone());
                                all_messages.push(Message::ToolResult(tr));
                            }
                            Err(e) => {
                                emit(
                                    tx,
                                    channel,
                                    StreamEvent::Error {
                                        message: e.to_string(),
                                    },
                                )?;
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
                        emit(
                            tx,
                            channel,
                            StreamEvent::MessageStart {
                                message: msg.clone(),
                            },
                        )?;
                        emit(
                            tx,
                            channel,
                            StreamEvent::MessageEnd {
                                message: msg.clone(),
                            },
                        )?;
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
    emit(
        tx,
        channel,
        StreamEvent::AgentEnd {
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
        },
    )?;
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
    provenance: &ProvenanceConfig,
) -> Result<AssistantMessage> {
    let max_retries = 3;
    let mut last_error = None;

    for attempt in 0..=max_retries {
        if *abort_rx.borrow() {
            let mut details = std::collections::HashMap::new();
            details.insert("attempt".to_string(), serde_json::json!(attempt + 1));
            details.insert("reason".to_string(), serde_json::json!("aborted"));
            emit_audit(tx, channel, provenance, "retry_cancelled", details)?;
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
                    let mut details = std::collections::HashMap::new();
                    details.insert("attempt".to_string(), serde_json::json!(attempt + 1));
                    details.insert("maxRetries".to_string(), serde_json::json!(max_retries));
                    details.insert("errorMessage".to_string(), serde_json::json!(error_msg));
                    details.insert("delayMs".to_string(), serde_json::json!(delay));
                    details.insert("decidedBy".to_string(), serde_json::json!("default"));
                    details.insert("willRetry".to_string(), serde_json::json!(true));
                    emit_audit(tx, channel, provenance, "retry_scheduled", details)?;
                    tokio::time::sleep(tokio::time::Duration::from_millis(delay)).await;
                } else {
                    let mut details = std::collections::HashMap::new();
                    details.insert("attempts".to_string(), serde_json::json!(max_retries + 1));
                    details.insert("errorMessage".to_string(), serde_json::json!(error_msg));
                    emit_audit(tx, channel, provenance, "retry_exhausted", details)?;
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

    let mut assistant_msg = AssistantMessage::new(Vec::new(), Vec::new(), StopReason::EndOfTurn);

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
                    emit(
                        tx,
                        channel,
                        StreamEvent::Error {
                            message: message.clone(),
                        },
                    )?;
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
                emit(
                    tx,
                    channel,
                    StreamEvent::Error {
                        message: e.to_string(),
                    },
                )?;
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
    provenance_config: &ProvenanceConfig,
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
        let mut details = std::collections::HashMap::new();
        details.insert("toolCallId".to_string(), serde_json::json!(tool_call.id.clone()));
        details.insert("toolName".to_string(), serde_json::json!(tool_call.name.clone()));
        details.insert("blockedBy".to_string(), serde_json::json!("beforeToolCall"));
        details.insert("blockReason".to_string(), serde_json::json!(reason.clone()));
        emit_audit(tx, channel, provenance_config, "tool_blocked", details)?;

        let mut err_msg =
            ToolResultMessage::error(tool_call.id.clone(), tool_call.name.clone(), reason.clone());
        if should_attach_message_provenance(provenance_config) {
            err_msg = err_msg.with_provenance(Provenance {
                blocked_by: Some("beforeToolCall".to_string()),
                block_reason: Some(reason),
                ..Default::default()
            });
        }
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

    let args_were_transformed = modified_args.is_some();
    if let Some(ref transformed_args) = modified_args {
        let mut details = std::collections::HashMap::new();
        details.insert("toolCallId".to_string(), serde_json::json!(tool_call.id.clone()));
        details.insert("toolName".to_string(), serde_json::json!(tool_call.name.clone()));
        details.insert("transformedBy".to_string(), serde_json::json!("beforeToolCall"));
        details.insert("originalArgsHash".to_string(), serde_json::json!(hash_json(&args)));
        details.insert(
            "transformedArgsHash".to_string(),
            serde_json::json!(hash_json(transformed_args)),
        );
        emit_audit(tx, channel, provenance_config, "tool_arguments_transformed", details)?;
    }
    let execution_args = modified_args.unwrap_or_else(|| args.clone());

    let tool_ctx = ToolContext {
        tool_call_id: tool_call.id.clone(),
        params: execution_args.clone(),
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

    let result = registry.dispatch(&tool_call.name, tool_ctx).await;

    let after_ctx = ToolContext {
        tool_call_id: tool_call.id.clone(),
        params: execution_args,
        signal: None,
        progress_tx: None,
    };
    let tool_result_msg = match &result {
        Ok(r) => {
            let after_actions = extensions.on_after_tool_call(tool_call, &after_ctx, r);

            let replacement = after_actions.iter().find_map(|a| match a {
                AfterToolCallAction::Replace { result: r } => Some((r.content.clone(), r.is_error)),
                _ => None,
            });
            let was_replaced = replacement.is_some();
            let original_result_hash = hash_json(&serde_json::json!({
                "content": r.content.clone(),
                "isError": r.is_error,
            }));
            let original_is_error = r.is_error;
            let (content, is_error) =
                replacement.unwrap_or_else(|| (r.content.clone(), r.is_error));

            if was_replaced {
                let mut details = std::collections::HashMap::new();
                details.insert("toolCallId".to_string(), serde_json::json!(tool_call.id.clone()));
                details.insert("toolName".to_string(), serde_json::json!(tool_call.name.clone()));
                details.insert("transformedBy".to_string(), serde_json::json!("afterToolCall"));
                details.insert("originalResultHash".to_string(), serde_json::json!(original_result_hash));
                details.insert(
                    "replacementResultHash".to_string(),
                    serde_json::json!(hash_json(&serde_json::json!({
                        "content": content.clone(),
                        "isError": is_error,
                    }))),
                );
                details.insert(
                    "isErrorChanged".to_string(),
                    serde_json::json!(original_is_error != is_error),
                );
                emit_audit(tx, channel, provenance_config, "tool_result_replaced", details)?;
            }

            let provenance = if should_attach_message_provenance(provenance_config)
                && (args_were_transformed || was_replaced)
            {
                let mut provenance = Provenance::default();
                let mut hook_details = std::collections::HashMap::new();
                if args_were_transformed {
                    provenance.transformed_by = Some("beforeToolCall".to_string());
                    hook_details.insert("argumentsTransformed".to_string(), serde_json::Value::Bool(true));
                }
                if was_replaced {
                    provenance.transformed_by = Some("afterToolCall".to_string());
                    hook_details.insert("replaced".to_string(), serde_json::Value::Bool(true));
                }
                if !hook_details.is_empty() {
                    provenance.hook_details = Some(hook_details);
                }
                Some(provenance)
            } else {
                None
            };

            ToolResultMessage {
                tool_call_id: tool_call.id.clone(),
                tool_name: tool_call.name.clone(),
                content,
                is_error,
                timestamp: chrono::Utc::now(),
                details: r.details.clone(),
                metadata: None,
                provenance,
            }
        }
        Err(e) => {
            ToolResultMessage::error(tool_call.id.clone(), tool_call.name.clone(), e.to_string())
        }
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
                msg.content.push(Content::Text { text: text.clone() });
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::extension::{
        AfterToolCallAction, BeforeToolCallAction, Extension, ExtensionManager,
    };
    use crate::llm::{
        LlmClient, LlmRequest, LlmResponse, LlmStream, LlmStreamEvent, Model, Provider,
    };
    use crate::messages::{Content, Provenance};
    use crate::tool::{ToolBuilder, ToolContext, ToolResult};
    use async_trait::async_trait;
    use serde_json::json;

    struct MockLlmClient {
        respond_with_tool_call: bool,
    }

    #[async_trait]
    impl LlmClient for MockLlmClient {
        fn provider(&self) -> Provider {
            Provider::Custom
        }

        async fn complete(&self, _request: LlmRequest) -> crate::error::Result<LlmResponse> {
            Ok(LlmResponse {
                message: AssistantMessage::new(vec![], vec![], StopReason::EndOfTurn),
                usage: Default::default(),
                stop_reason: StopReason::EndOfTurn,
            })
        }

        async fn stream(&self, _request: LlmRequest) -> crate::error::Result<LlmStream> {
            let (tx, rx) = tokio::sync::mpsc::channel(8);
            if self.respond_with_tool_call {
                let msg = AssistantMessage::new(
                    vec![Content::Text {
                        text: "calling tool".into(),
                    }],
                    vec![ToolCall {
                        id: "tc-1".into(),
                        name: "test_tool".into(),
                        arguments: json!({"query": "original"}),
                        thinking_signature: None,
                    }],
                    StopReason::ToolCalls,
                );
                let _ = tx.send(Ok(LlmStreamEvent::Done { message: msg })).await;
            } else {
                let msg = AssistantMessage::new(
                    vec![Content::Text {
                        text: "done".into(),
                    }],
                    vec![],
                    StopReason::EndOfTurn,
                );
                let _ = tx.send(Ok(LlmStreamEvent::Done { message: msg })).await;
            }
            Ok(Box::pin(tokio_stream::wrappers::ReceiverStream::new(rx)))
        }
    }

    struct BlockExtension;
    impl Extension for BlockExtension {
        fn on_before_tool_call(&self, _tc: &ToolCall, _ctx: &ToolContext) -> BeforeToolCallAction {
            BeforeToolCallAction::Block {
                reason: "blocked by policy".into(),
            }
        }
    }

    struct TransformExtension;
    impl Extension for TransformExtension {
        fn on_before_tool_call(&self, _tc: &ToolCall, _ctx: &ToolContext) -> BeforeToolCallAction {
            BeforeToolCallAction::Transform {
                modified_args: json!({"query": "modified"}),
            }
        }
    }

    struct ReplaceExtension;
    impl Extension for ReplaceExtension {
        fn on_after_tool_call(
            &self,
            _tc: &ToolCall,
            _ctx: &ToolContext,
            _result: &ToolResult,
        ) -> AfterToolCallAction {
            AfterToolCallAction::Replace {
                result: ToolResult::success(json!({"replaced": true})),
            }
        }
    }

    #[tokio::test]
    async fn test_block_provenance() {
        let mut ext = ExtensionManager::new();
        ext.add(BlockExtension);

        let client = Arc::new(MockLlmClient {
            respond_with_tool_call: true,
        });
        let tool = ToolBuilder::new("test_tool")
            .description("test")
            .parameters(json!({}))
            .execute(|_ctx| async { Ok(ToolResult::success(json!("should not run"))) })
            .build();

        let tool_registry = ToolRegistry::new();
        tool_registry.register(tool);

        let builder = AgentBuilder::new(Model::new(Provider::Custom, "test-model"))
            .tools(Arc::new(tool_registry))
            .extensions(ext)
            .max_turns(1);

        let agent = builder.build(client);
        let (mut rx, _channel, _handle) = agent.run("test".to_string()).await.unwrap();

        let mut found_provenance: Option<Provenance> = None;
        let mut saw_tool_blocked_audit = false;
        while let Some(event) = rx.recv().await {
            match event {
                Ok(StreamEvent::ToolExecutionEnd { result, .. }) => {
                    found_provenance = result.provenance;
                }
                Ok(StreamEvent::Audit { event_type, .. }) if event_type == "tool_blocked" => {
                    saw_tool_blocked_audit = true;
                }
                _ => {}
            }
        }

        let prov = found_provenance.expect("expected provenance on blocked tool result");
        assert_eq!(prov.blocked_by, Some("beforeToolCall".to_string()));
        assert_eq!(prov.block_reason, Some("blocked by policy".to_string()));
        assert!(saw_tool_blocked_audit, "expected tool_blocked audit event");
    }

    #[tokio::test]
    async fn test_transform_provenance() {
        let mut ext = ExtensionManager::new();
        ext.add(TransformExtension);

        let client = Arc::new(MockLlmClient {
            respond_with_tool_call: true,
        });
        let tool = ToolBuilder::new("test_tool")
            .description("test")
            .parameters(json!({}))
            .execute(|ctx| async move {
                // Tool should see modified args
                let q = ctx.params["query"].as_str().unwrap_or("");
                Ok(ToolResult::success(json!({"seen": q})))
            })
            .build();

        let tool_registry = ToolRegistry::new();
        tool_registry.register(tool);

        let builder = AgentBuilder::new(Model::new(Provider::Custom, "test-model"))
            .tools(Arc::new(tool_registry))
            .extensions(ext)
            .max_turns(1);

        let agent = builder.build(client);
        let (mut rx, _channel, _handle) = agent.run("test".to_string()).await.unwrap();

        let mut found_provenance: Option<Provenance> = None;
        while let Some(event) = rx.recv().await {
            if let Ok(StreamEvent::ToolExecutionEnd { result, .. }) = event {
                found_provenance = result.provenance;
            }
        }

        let prov = found_provenance.expect("expected provenance on transformed tool result");
        assert_eq!(prov.transformed_by, Some("beforeToolCall".to_string()));
    }

    #[tokio::test]
    async fn test_after_tool_call_replace_provenance() {
        let mut ext = ExtensionManager::new();
        ext.add(ReplaceExtension);

        let client = Arc::new(MockLlmClient {
            respond_with_tool_call: true,
        });
        let tool = ToolBuilder::new("test_tool")
            .description("test")
            .parameters(json!({}))
            .execute(|_ctx| async { Ok(ToolResult::success(json!({"raw": true}))) })
            .build();

        let tool_registry = ToolRegistry::new();
        tool_registry.register(tool);

        let builder = AgentBuilder::new(Model::new(Provider::Custom, "test-model"))
            .tools(Arc::new(tool_registry))
            .extensions(ext)
            .max_turns(1);

        let agent = builder.build(client);
        let (mut rx, _channel, _handle) = agent.run("test".to_string()).await.unwrap();

        let mut found_result = None;
        while let Some(event) = rx.recv().await {
            if let Ok(StreamEvent::ToolExecutionEnd { result, .. }) = event {
                found_result = Some(result);
            }
        }

        let result = found_result.expect("expected tool result");
        assert_eq!(result.content, json!({"replaced": true}));
        let prov = result
            .provenance
            .expect("expected provenance on replaced tool result");
        assert_eq!(prov.transformed_by, Some("afterToolCall".to_string()));
        assert_eq!(
            prov.hook_details
                .as_ref()
                .and_then(|details| details.get("replaced")),
            Some(&json!(true)),
        );
    }

    #[tokio::test]
    async fn test_no_provenance_for_normal_execution() {
        let client = Arc::new(MockLlmClient {
            respond_with_tool_call: true,
        });
        let tool = ToolBuilder::new("test_tool")
            .description("test")
            .parameters(json!({}))
            .execute(|_ctx| async { Ok(ToolResult::success(json!("ok"))) })
            .build();

        let tool_registry = ToolRegistry::new();
        tool_registry.register(tool);

        let builder = AgentBuilder::new(Model::new(Provider::Custom, "test-model"))
            .tools(Arc::new(tool_registry))
            .max_turns(1);

        let agent = builder.build(client);
        let (mut rx, _channel, _handle) = agent.run("test".to_string()).await.unwrap();

        let mut found_provenance: Option<Provenance> = None;
        while let Some(event) = rx.recv().await {
            if let Ok(StreamEvent::ToolExecutionEnd { result, .. }) = event {
                found_provenance = result.provenance;
            }
        }

        assert!(
            found_provenance.is_none(),
            "normal execution should not have provenance"
        );
    }

    #[tokio::test]
    async fn test_provenance_can_be_disabled() {
        let mut ext = ExtensionManager::new();
        ext.add(BlockExtension);

        let client = Arc::new(MockLlmClient {
            respond_with_tool_call: true,
        });
        let tool = ToolBuilder::new("test_tool")
            .description("test")
            .parameters(json!({}))
            .execute(|_ctx| async { Ok(ToolResult::success(json!("should not run"))) })
            .build();

        let tool_registry = ToolRegistry::new();
        tool_registry.register(tool);

        let builder = AgentBuilder::new(Model::new(Provider::Custom, "test-model"))
            .tools(Arc::new(tool_registry))
            .extensions(ext)
            .provenance(false)
            .max_turns(1);

        let agent = builder.build(client);
        let (mut rx, _channel, _handle) = agent.run("test".to_string()).await.unwrap();

        let mut saw_audit = false;
        let mut found_provenance: Option<Provenance> = None;
        while let Some(event) = rx.recv().await {
            match event {
                Ok(StreamEvent::Audit { .. }) => saw_audit = true,
                Ok(StreamEvent::ToolExecutionEnd { result, .. }) => {
                    found_provenance = result.provenance;
                }
                _ => {}
            }
        }

        assert!(!saw_audit, "disabled provenance should suppress audit events");
        assert!(
            found_provenance.is_none(),
            "disabled provenance should suppress message provenance"
        );
    }
}
