pub mod engine;
pub mod fs_store;
pub mod sqlite_store;

pub use engine::{EngineLifecycle, SessionEngine, SessionEngineConfig, SessionEngineResult};
pub use fs_store::FileSystemSessionStore;
pub use sqlite_store::SQLiteSessionStore;

use crate::llm::Model;
use crate::messages::Message;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;
use uuid::Uuid;

// ─── Entry Types ────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionEntryBase {
    pub id: String,
    pub parent_id: Option<String>,
    pub timestamp: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum SessionEntry {
    Message(MessageEntry),
    Audit(AuditEntry),
    Custom(CustomEntry),
    ModelChange(ModelChangeEntry),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageEntry {
    #[serde(flatten)]
    pub base: SessionEntryBase,
    pub message: Box<Message>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditEntry {
    #[serde(flatten)]
    pub base: SessionEntryBase,
    pub event_type: String,
    pub details: HashMap<String, serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomEntry {
    #[serde(flatten)]
    pub base: SessionEntryBase,
    pub custom_type: String,
    pub data: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelChangeEntry {
    #[serde(flatten)]
    pub base: SessionEntryBase,
    pub provider: String,
    pub model_id: String,
}

impl SessionEntry {
    pub fn base(&self) -> &SessionEntryBase {
        match self {
            SessionEntry::Message(e) => &e.base,
            SessionEntry::Audit(e) => &e.base,
            SessionEntry::Custom(e) => &e.base,
            SessionEntry::ModelChange(e) => &e.base,
        }
    }

    pub fn id(&self) -> &str {
        &self.base().id
    }

    pub fn parent_id(&self) -> Option<&str> {
        self.base().parent_id.as_deref()
    }
}

// ─── Session Types ──────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionMetadata {
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub turn_count: usize,
    pub token_usage: TokenUsageSummary,
    pub is_streaming: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tenant_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct TokenUsageSummary {
    pub input: u64,
    pub output: u64,
    pub cache_read: u64,
    pub cache_write: u64,
    pub total_tokens: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionConfig {
    pub model: Model,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub system_prompt: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_turns: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_tokens: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub temperature: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub api_key: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub id: String,
    pub model: Model,
    pub entries: Vec<SessionEntry>,
    pub config: SessionConfig,
    pub metadata: SessionMetadata,
}

#[derive(Debug, Clone, Default)]
pub struct SessionFilter {
    pub user_id: Option<String>,
    pub tenant_id: Option<String>,
    pub limit: Option<usize>,
    pub offset: Option<usize>,
    pub status: Option<SessionStatus>,
}

#[derive(Debug, Clone)]
pub enum SessionStatus {
    Active,
    Completed,
    Error,
}

// ─── Tree Types ─────────────────────────────────────────────────────────────

#[derive(Debug, Clone)]
pub struct SessionTreeNode {
    pub entry: SessionEntry,
    pub children: Vec<SessionTreeNode>,
}

#[derive(Debug, Clone)]
pub struct SessionContext {
    pub messages: Vec<Message>,
    pub model: Model,
}

// ─── SessionStore Trait ─────────────────────────────────────────────────────

#[async_trait::async_trait]
pub trait SessionStore: Send + Sync {
    async fn create(&self, session: Session) -> crate::error::Result<Session>;
    async fn load(&self, id: &str) -> crate::error::Result<Option<Session>>;
    async fn save(&self, session: &Session) -> crate::error::Result<()>;
    async fn delete(&self, id: &str) -> crate::error::Result<bool>;
    async fn list(&self, filter: &SessionFilter) -> crate::error::Result<Vec<Session>>;
}

// ─── InMemorySessionStore ───────────────────────────────────────────────────

pub struct InMemorySessionStore {
    sessions: Mutex<HashMap<String, Session>>,
}

impl InMemorySessionStore {
    pub fn new() -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
        }
    }
}

impl Default for InMemorySessionStore {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait::async_trait]
impl SessionStore for InMemorySessionStore {
    async fn create(&self, session: Session) -> crate::error::Result<Session> {
        let mut sessions = self.sessions.lock().await;
        sessions.insert(session.id.clone(), session.clone());
        Ok(session)
    }

    async fn load(&self, id: &str) -> crate::error::Result<Option<Session>> {
        let sessions = self.sessions.lock().await;
        Ok(sessions.get(id).cloned())
    }

    async fn save(&self, session: &Session) -> crate::error::Result<()> {
        let mut sessions = self.sessions.lock().await;
        sessions.insert(session.id.clone(), session.clone());
        Ok(())
    }

    async fn delete(&self, id: &str) -> crate::error::Result<bool> {
        let mut sessions = self.sessions.lock().await;
        Ok(sessions.remove(id).is_some())
    }

    async fn list(&self, filter: &SessionFilter) -> crate::error::Result<Vec<Session>> {
        let sessions = self.sessions.lock().await;
        let mut result: Vec<Session> = sessions.values().cloned().collect();

        if let Some(uid) = &filter.user_id {
            result.retain(|s| s.metadata.user_id.as_deref() == Some(uid));
        }

        if let Some(tid) = &filter.tenant_id {
            result.retain(|s| s.metadata.tenant_id.as_deref() == Some(tid));
        }

        if let Some(status) = &filter.status {
            result.retain(|s| match status {
                SessionStatus::Active => s.metadata.is_streaming,
                SessionStatus::Completed => !s.metadata.is_streaming && s.metadata.error.is_none(),
                SessionStatus::Error => s.metadata.error.is_some(),
            });
        }

        result.sort_by_key(|a| std::cmp::Reverse(a.metadata.updated_at));

        if let Some(offset) = filter.offset {
            if offset >= result.len() {
                return Ok(vec![]);
            }
            result = result.into_iter().skip(offset).collect();
        }

        if let Some(limit) = filter.limit {
            result.truncate(limit);
        }

        Ok(result)
    }
}

// ─── SessionManager ─────────────────────────────────────────────────────────

#[derive(Clone)]
pub struct SessionManager {
    store: Arc<dyn SessionStore>,
}

impl SessionManager {
    pub fn new(store: Arc<dyn SessionStore>) -> Self {
        Self { store }
    }

    pub async fn create(
        &self,
        config: SessionConfig,
        user_id: Option<String>,
    ) -> crate::error::Result<Session> {
        self.create_with_tenant(config, user_id, None).await
    }

    pub async fn create_with_tenant(
        &self,
        config: SessionConfig,
        user_id: Option<String>,
        tenant_id: Option<String>,
    ) -> crate::error::Result<Session> {
        let now = Utc::now();
        let session = Session {
            id: Uuid::new_v4().to_string(),
            model: config.model.clone(),
            entries: Vec::new(),
            config,
            metadata: SessionMetadata {
                created_at: now,
                updated_at: now,
                turn_count: 0,
                token_usage: TokenUsageSummary::default(),
                is_streaming: false,
                error: None,
                parent_session_id: None,
                user_id,
                tenant_id,
            },
        };
        self.store.create(session).await
    }

    pub async fn load(&self, id: &str) -> crate::error::Result<Option<Session>> {
        self.store.load(id).await
    }

    pub async fn save(&self, session: &mut Session) -> crate::error::Result<()> {
        session.metadata.updated_at = Utc::now();
        self.store.save(session).await
    }

    pub async fn delete(&self, id: &str) -> crate::error::Result<bool> {
        self.store.delete(id).await
    }

    pub async fn list(&self, filter: &SessionFilter) -> crate::error::Result<Vec<Session>> {
        self.store.list(filter).await
    }

    pub fn append_entry(&self, session: &mut Session, entry: SessionEntry) -> String {
        let id = entry.id().to_string();
        let leaf_id = find_leaf_id(&session.entries);
        let mut entry = entry;
        match &mut entry {
            SessionEntry::Message(e) => e.base.parent_id = leaf_id.clone(),
            SessionEntry::Audit(e) => e.base.parent_id = leaf_id.clone(),
            SessionEntry::Custom(e) => e.base.parent_id = leaf_id.clone(),
            SessionEntry::ModelChange(e) => e.base.parent_id = leaf_id.clone(),
        }
        session.entries.push(entry);
        id
    }

    pub fn append_message(&self, session: &mut Session, message: Message) -> String {
        let entry = SessionEntry::Message(MessageEntry {
            base: SessionEntryBase {
                id: Uuid::new_v4().to_string(),
                parent_id: None,
                timestamp: Utc::now(),
            },
            message: Box::new(message),
        });
        self.append_entry(session, entry)
    }

    pub fn append_audit(
        &self,
        session: &mut Session,
        event_type: impl Into<String>,
        details: HashMap<String, serde_json::Value>,
    ) -> String {
        let entry = SessionEntry::Audit(AuditEntry {
            base: SessionEntryBase {
                id: Uuid::new_v4().to_string(),
                parent_id: None,
                timestamp: Utc::now(),
            },
            event_type: event_type.into(),
            details,
        });
        self.append_entry(session, entry)
    }

    pub fn append_custom(
        &self,
        session: &mut Session,
        custom_type: impl Into<String>,
        data: serde_json::Value,
    ) -> String {
        let entry = SessionEntry::Custom(CustomEntry {
            base: SessionEntryBase {
                id: Uuid::new_v4().to_string(),
                parent_id: None,
                timestamp: Utc::now(),
            },
            custom_type: custom_type.into(),
            data,
        });
        self.append_entry(session, entry)
    }

    pub fn append_model_change(&self, session: &mut Session, model: &Model) -> String {
        let entry = SessionEntry::ModelChange(ModelChangeEntry {
            base: SessionEntryBase {
                id: Uuid::new_v4().to_string(),
                parent_id: None,
                timestamp: Utc::now(),
            },
            provider: model.provider.to_string(),
            model_id: model.id.clone(),
        });
        session.model = model.clone();
        self.append_entry(session, entry)
    }

    pub fn get_branch(&self, session: &Session, entry_id: Option<&str>) -> Vec<SessionEntry> {
        get_branch_path(&session.entries, entry_id)
    }

    pub fn get_tree(&self, session: &Session) -> Vec<SessionTreeNode> {
        build_tree(&session.entries)
    }

    pub fn get_leaf_id(&self, session: &Session) -> Option<String> {
        find_leaf_id(&session.entries)
    }

    pub fn build_context(&self, session: &Session, entry_id: Option<&str>) -> SessionContext {
        let branch = self.get_branch(session, entry_id);
        let messages = branch
            .into_iter()
            .filter_map(|e| match e {
                SessionEntry::Message(m) => Some(*m.message),
                _ => None,
            })
            .collect();

        SessionContext {
            messages,
            model: session.model.clone(),
        }
    }

    pub async fn fork(
        &self,
        source_id: &str,
        branch_from_entry_id: Option<&str>,
    ) -> crate::error::Result<Option<Session>> {
        let source = match self.store.load(source_id).await? {
            Some(s) => s,
            None => return Ok(None),
        };

        let branch = self.get_branch(&source, branch_from_entry_id);
        let now = Utc::now();

        let forked = Session {
            id: Uuid::new_v4().to_string(),
            model: source.model.clone(),
            entries: branch,
            config: source.config.clone(),
            metadata: SessionMetadata {
                created_at: now,
                updated_at: now,
                turn_count: 0,
                token_usage: TokenUsageSummary::default(),
                is_streaming: false,
                error: None,
                parent_session_id: Some(source_id.to_string()),
                user_id: source.metadata.user_id.clone(),
                tenant_id: source.metadata.tenant_id.clone(),
            },
        };

        let created = self.store.create(forked).await?;
        Ok(Some(created))
    }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

fn find_leaf_id(entries: &[SessionEntry]) -> Option<String> {
    // The last entry is the leaf (linear append model)
    entries.last().map(|e| e.id().to_string())
}

fn get_branch_path(entries: &[SessionEntry], target_id: Option<&str>) -> Vec<SessionEntry> {
    let target = match target_id {
        Some(id) => id,
        None => {
            // Return all entries (linear path to leaf)
            return entries.to_vec();
        }
    };

    let entry_by_id: HashMap<&str, &SessionEntry> = entries.iter().map(|e| (e.id(), e)).collect();

    // Walk from target back to root via parent_id, then reverse into root-to-target order.
    let mut chain = Vec::new();
    let mut current = Some(target);

    while let Some(id) = current {
        let entry = match entry_by_id.get(id) {
            Some(entry) => *entry,
            None => break,
        };
        chain.push(entry.clone());
        current = entry.parent_id();
    }

    chain.reverse();
    chain
}

fn build_tree(entries: &[SessionEntry]) -> Vec<SessionTreeNode> {
    use std::collections::HashMap as Map;

    let mut entry_map: Map<String, &SessionEntry> = Map::new();
    let mut child_map: Map<String, Vec<String>> = Map::new();
    let mut root_ids: Vec<String> = Vec::new();

    for entry in entries {
        let id = entry.id().to_string();
        entry_map.insert(id.clone(), entry);
        match entry.parent_id() {
            Some(pid) => child_map.entry(pid.to_string()).or_default().push(id),
            None => root_ids.push(id),
        }
    }

    fn build_node(
        id: &str,
        entry_map: &Map<String, &SessionEntry>,
        child_map: &Map<String, Vec<String>>,
    ) -> SessionTreeNode {
        let children = child_map
            .get(id)
            .map(|kids| {
                kids.iter()
                    .map(|kid| build_node(kid, entry_map, child_map))
                    .collect()
            })
            .unwrap_or_default();
        SessionTreeNode {
            entry: entry_map[id].clone(),
            children,
        }
    }

    root_ids
        .iter()
        .map(|id| build_node(id, &entry_map, &child_map))
        .collect()
}

// ─── Tests ──────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::llm::Provider;
    use serde_json::json;

    fn test_model() -> Model {
        Model::new(Provider::Custom, "test-model")
    }

    fn test_config() -> SessionConfig {
        SessionConfig {
            model: test_model(),
            system_prompt: Some("You are helpful.".into()),
            max_turns: None,
            max_tokens: None,
            temperature: None,
            api_key: None,
        }
    }

    #[tokio::test]
    async fn test_create_and_load() {
        let store = Arc::new(InMemorySessionStore::new());
        let mgr = SessionManager::new(store);

        let session = mgr
            .create(test_config(), Some("user-1".into()))
            .await
            .unwrap();
        assert!(!session.id.is_empty());
        assert_eq!(session.metadata.user_id, Some("user-1".into()));
        assert!(session.entries.is_empty());

        let loaded = mgr.load(&session.id).await.unwrap();
        assert!(loaded.is_some());
        assert_eq!(loaded.unwrap().id, session.id);
    }

    #[tokio::test]
    async fn test_append_message() {
        let store = Arc::new(InMemorySessionStore::new());
        let mgr = SessionManager::new(store);

        let mut session = mgr.create(test_config(), None).await.unwrap();

        mgr.append_message(
            &mut session,
            Message::User(crate::messages::UserMessage::text("Hello")),
        );
        mgr.append_message(
            &mut session,
            Message::User(crate::messages::UserMessage::text("World")),
        );

        assert_eq!(session.entries.len(), 2);
        // Second entry's parent should be the first
        assert_eq!(
            session.entries[1].parent_id(),
            Some(session.entries[0].id())
        );
    }

    #[tokio::test]
    async fn test_append_audit() {
        let store = Arc::new(InMemorySessionStore::new());
        let mgr = SessionManager::new(store);

        let mut session = mgr.create(test_config(), None).await.unwrap();
        mgr.append_message(
            &mut session,
            Message::User(crate::messages::UserMessage::text("test")),
        );

        let mut details = HashMap::new();
        details.insert("tool".to_string(), json!("bash"));
        details.insert("reason".to_string(), json!("policy violation"));

        mgr.append_audit(&mut session, "tool_blocked", details);

        assert_eq!(session.entries.len(), 2);
        match &session.entries[1] {
            SessionEntry::Audit(a) => {
                assert_eq!(a.event_type, "tool_blocked");
                assert_eq!(a.details["tool"], json!("bash"));
            }
            _ => panic!("Expected audit entry"),
        }
    }

    #[tokio::test]
    async fn test_append_model_change() {
        let store = Arc::new(InMemorySessionStore::new());
        let mgr = SessionManager::new(store);

        let mut session = mgr.create(test_config(), None).await.unwrap();
        let new_model = Model::new(Provider::OpenAI, "gpt-4o");

        mgr.append_model_change(&mut session, &new_model);

        assert_eq!(session.model.provider, Provider::OpenAI);
        assert_eq!(session.model.id, "gpt-4o");
        match &session.entries[0] {
            SessionEntry::ModelChange(m) => {
                assert_eq!(m.provider, "openai");
                assert_eq!(m.model_id, "gpt-4o");
            }
            _ => panic!("Expected model change entry"),
        }
    }

    #[tokio::test]
    async fn test_build_context_skips_non_message_entries() {
        let store = Arc::new(InMemorySessionStore::new());
        let mgr = SessionManager::new(store);

        let mut session = mgr.create(test_config(), None).await.unwrap();
        mgr.append_message(
            &mut session,
            Message::User(crate::messages::UserMessage::text("Hello")),
        );

        let mut details = HashMap::new();
        details.insert("by".to_string(), json!("hook-x"));
        mgr.append_audit(&mut session, "context_transformed", details);

        mgr.append_message(
            &mut session,
            Message::User(crate::messages::UserMessage::text("World")),
        );

        let ctx = mgr.build_context(&session, None);
        assert_eq!(ctx.messages.len(), 2); // audit skipped
    }

    #[tokio::test]
    async fn test_fork() {
        let store = Arc::new(InMemorySessionStore::new());
        let mgr = SessionManager::new(store);

        let mut session = mgr.create(test_config(), None).await.unwrap();
        mgr.append_message(
            &mut session,
            Message::User(crate::messages::UserMessage::text("msg1")),
        );
        let fork_point = mgr.append_message(
            &mut session,
            Message::User(crate::messages::UserMessage::text("msg2")),
        );
        mgr.append_message(
            &mut session,
            Message::User(crate::messages::UserMessage::text("msg3")),
        );
        mgr.save(&mut session).await.unwrap();

        let forked = mgr
            .fork(&session.id, Some(&fork_point))
            .await
            .unwrap()
            .unwrap();

        assert_ne!(forked.id, session.id);
        assert_eq!(forked.entries.len(), 2); // branch up to fork_point
        assert_eq!(forked.metadata.parent_session_id, Some(session.id));
    }

    #[tokio::test]
    async fn test_list_with_filter() {
        let store = Arc::new(InMemorySessionStore::new());
        let mgr = SessionManager::new(store);

        mgr.create(test_config(), Some("user-1".into()))
            .await
            .unwrap();
        mgr.create(test_config(), Some("user-2".into()))
            .await
            .unwrap();
        mgr.create(test_config(), Some("user-1".into()))
            .await
            .unwrap();

        let all = mgr.list(&SessionFilter::default()).await.unwrap();
        assert_eq!(all.len(), 3);

        let filtered = mgr
            .list(&SessionFilter {
                user_id: Some("user-1".into()),
                ..Default::default()
            })
            .await
            .unwrap();
        assert_eq!(filtered.len(), 2);

        let limited = mgr
            .list(&SessionFilter {
                limit: Some(1),
                ..Default::default()
            })
            .await
            .unwrap();
        assert_eq!(limited.len(), 1);
    }

    #[tokio::test]
    async fn test_create_and_fork_preserve_tenant() {
        let store = Arc::new(InMemorySessionStore::new());
        let mgr = SessionManager::new(store);

        let mut session = mgr
            .create_with_tenant(
                test_config(),
                Some("user-1".into()),
                Some("tenant-1".into()),
            )
            .await
            .unwrap();
        mgr.append_message(
            &mut session,
            Message::User(crate::messages::UserMessage::text("msg1")),
        );
        mgr.save(&mut session).await.unwrap();

        let filtered = mgr
            .list(&SessionFilter {
                tenant_id: Some("tenant-1".into()),
                ..Default::default()
            })
            .await
            .unwrap();
        assert_eq!(filtered.len(), 1);

        let forked = mgr.fork(&session.id, None).await.unwrap().unwrap();
        assert_eq!(forked.metadata.user_id, Some("user-1".into()));
        assert_eq!(forked.metadata.tenant_id, Some("tenant-1".into()));
    }

    #[tokio::test]
    async fn test_branch_order_independent_of_entry_storage_order() {
        let store = Arc::new(InMemorySessionStore::new());
        let mgr = SessionManager::new(store);

        let mut session = mgr.create(test_config(), None).await.unwrap();
        let root_id = mgr.append_message(
            &mut session,
            Message::User(crate::messages::UserMessage::text("root")),
        );
        let child_id = mgr.append_message(
            &mut session,
            Message::User(crate::messages::UserMessage::text("child")),
        );
        let grandchild_id = mgr.append_message(
            &mut session,
            Message::User(crate::messages::UserMessage::text("grandchild")),
        );
        session.entries.swap(0, 1);

        let branch = mgr.get_branch(&session, Some(&grandchild_id));
        let ids: Vec<&str> = branch.iter().map(SessionEntry::id).collect();
        assert_eq!(
            ids,
            vec![root_id.as_str(), child_id.as_str(), grandchild_id.as_str()]
        );
    }

    #[tokio::test]
    async fn test_build_tree_handles_arbitrary_depth() {
        let store = Arc::new(InMemorySessionStore::new());
        let mgr = SessionManager::new(store);

        let mut session = mgr.create(test_config(), None).await.unwrap();
        mgr.append_message(
            &mut session,
            Message::User(crate::messages::UserMessage::text("depth-1")),
        );
        mgr.append_message(
            &mut session,
            Message::User(crate::messages::UserMessage::text("depth-2")),
        );
        mgr.append_message(
            &mut session,
            Message::User(crate::messages::UserMessage::text("depth-3")),
        );
        mgr.append_message(
            &mut session,
            Message::User(crate::messages::UserMessage::text("depth-4")),
        );

        let tree = mgr.get_tree(&session);
        assert_eq!(tree.len(), 1);
        assert_eq!(tree[0].children.len(), 1);
        assert_eq!(tree[0].children[0].children.len(), 1);
        assert_eq!(tree[0].children[0].children[0].children.len(), 1);
    }

    #[tokio::test]
    async fn test_session_serializes_with_camel_case_fields() {
        let store = Arc::new(InMemorySessionStore::new());
        let mgr = SessionManager::new(store);

        let mut session = mgr
            .create_with_tenant(
                test_config(),
                Some("user-1".into()),
                Some("tenant-1".into()),
            )
            .await
            .unwrap();
        mgr.append_audit(&mut session, "event", HashMap::new());
        mgr.append_model_change(&mut session, &Model::new(Provider::OpenAI, "gpt-4o"));

        let json = serde_json::to_value(&session).unwrap();
        assert!(json["metadata"].get("createdAt").is_some());
        assert!(json["metadata"].get("userId").is_some());
        assert!(json["metadata"].get("tenantId").is_some());
        assert!(json["entries"][0].get("parentId").is_some());
        assert!(json["entries"][0].get("eventType").is_some());
        assert!(json["entries"][1].get("modelId").is_some());
    }

    #[tokio::test]
    async fn test_delete() {
        let store = Arc::new(InMemorySessionStore::new());
        let mgr = SessionManager::new(store);

        let session = mgr.create(test_config(), None).await.unwrap();
        assert!(mgr.delete(&session.id).await.unwrap());
        assert!(mgr.load(&session.id).await.unwrap().is_none());
        assert!(!mgr.delete("nonexistent").await.unwrap());
    }
}
