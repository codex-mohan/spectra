use std::collections::HashMap;
use std::sync::Arc;

use crate::agent::AgentBuilder;
use crate::llm::LlmClient;

#[derive(Debug, Clone)]
pub struct DelegationResult {
    pub agent_type: String,
    pub success: bool,
    pub output: String,
    pub error: Option<String>,
}

#[derive(Debug, Clone)]
pub struct TaskConfig {
    pub agent_type: String,
    pub task: String,
}

struct StoredAgent {
    client: Arc<dyn LlmClient>,
    builder: AgentBuilder,
}

pub struct AgentRegistry {
    agents: HashMap<String, StoredAgent>,
}

impl AgentRegistry {
    pub fn new() -> Self {
        Self {
            agents: HashMap::new(),
        }
    }

    pub fn register(
        &mut self,
        name: impl Into<String>,
        client: Arc<dyn LlmClient>,
        builder: AgentBuilder,
    ) {
        self.agents.insert(
            name.into(),
            StoredAgent { client, builder },
        );
    }

    pub async fn delegate(&self, agent_type: &str, task: &str) -> DelegationResult {
        let stored = match self.agents.get(agent_type) {
            Some(s) => s,
            None => {
                return DelegationResult {
                    agent_type: agent_type.to_string(),
                    success: false,
                    output: String::new(),
                    error: Some(format!("Unknown agent type: {agent_type}")),
                };
            }
        };

        let agent = stored.builder.clone().build(stored.client.clone());

        let result = agent.run(task).await;
        let (_rx, _channel, _handle) = match result {
            Ok(handle) => handle,
            Err(e) => {
                return DelegationResult {
                    agent_type: agent_type.to_string(),
                    success: false,
                    output: String::new(),
                    error: Some(e.to_string()),
                };
            }
        };

        DelegationResult {
            agent_type: agent_type.to_string(),
            success: true,
            output: String::new(),
            error: None,
        }
    }

    pub async fn execute_parallel(&self, tasks: &[TaskConfig]) -> Vec<DelegationResult> {
        futures_util::future::join_all(tasks.iter().map(|t| self.delegate(&t.agent_type, &t.task)))
            .await
    }

    pub fn contains(&self, agent_type: &str) -> bool {
        self.agents.contains_key(agent_type)
    }

    pub fn len(&self) -> usize {
        self.agents.len()
    }

    pub fn is_empty(&self) -> bool {
        self.agents.is_empty()
    }
}

impl Default for AgentRegistry {
    fn default() -> Self {
        Self::new()
    }
}
