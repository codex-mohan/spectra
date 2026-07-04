use super::{Session, SessionFilter, SessionStatus, SessionStore};
use crate::error::Result;
use async_trait::async_trait;
use std::path::PathBuf;
use tokio::fs;

pub struct FileSystemSessionStore {
    dir: PathBuf,
}

impl FileSystemSessionStore {
    pub fn new(dir: impl Into<PathBuf>) -> Self {
        Self { dir: dir.into() }
    }

    fn path_for(&self, id: &str) -> PathBuf {
        self.dir.join(format!("{id}.json"))
    }
}

#[async_trait]
impl SessionStore for FileSystemSessionStore {
    async fn create(&self, session: Session) -> Result<Session> {
        fs::create_dir_all(&self.dir).await?;
        let path = self.path_for(&session.id);
        let json = serde_json::to_string_pretty(&session)?;
        fs::write(path, json).await?;
        Ok(session)
    }

    async fn load(&self, id: &str) -> Result<Option<Session>> {
        let path = self.path_for(id);
        if !path.exists() {
            return Ok(None);
        }
        let json = fs::read_to_string(path).await?;
        let session: Session = serde_json::from_str(&json)?;
        Ok(Some(session))
    }

    async fn save(&self, session: &Session) -> Result<()> {
        fs::create_dir_all(&self.dir).await?;
        let path = self.path_for(&session.id);
        let json = serde_json::to_string_pretty(session)?;
        fs::write(path, json).await?;
        Ok(())
    }

    async fn delete(&self, id: &str) -> Result<bool> {
        let path = self.path_for(id);
        if path.exists() {
            fs::remove_file(path).await?;
            Ok(true)
        } else {
            Ok(false)
        }
    }

    async fn list(&self, filter: &SessionFilter) -> Result<Vec<Session>> {
        let dir = &self.dir;
        if !dir.exists() {
            return Ok(vec![]);
        }

        let mut entries = fs::read_dir(dir).await?;
        let mut sessions = Vec::new();

        while let Some(entry) = entries.next_entry().await? {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) == Some("json") {
                let json = fs::read_to_string(&path).await?;
                let session = serde_json::from_str::<Session>(&json)?;
                sessions.push(session);
            }
        }

        // Apply filters
        if let Some(uid) = &filter.user_id {
            sessions.retain(|s| s.metadata.user_id.as_deref() == Some(uid));
        }
        if let Some(tid) = &filter.tenant_id {
            sessions.retain(|s| s.metadata.tenant_id.as_deref() == Some(tid));
        }
        if let Some(status) = &filter.status {
            sessions.retain(|s| match status {
                SessionStatus::Active => s.metadata.is_streaming,
                SessionStatus::Completed => !s.metadata.is_streaming && s.metadata.error.is_none(),
                SessionStatus::Error => s.metadata.error.is_some(),
            });
        }

        // Sort newest first
        sessions.sort_by_key(|s| std::cmp::Reverse(s.metadata.updated_at));

        // Offset + limit
        if let Some(offset) = filter.offset {
            if offset >= sessions.len() {
                return Ok(vec![]);
            }
            sessions = sessions.into_iter().skip(offset).collect();
        }
        if let Some(limit) = filter.limit {
            sessions.truncate(limit);
        }

        Ok(sessions)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::llm::{Model, Provider};
    use crate::messages::{Message, UserMessage};
    use crate::session::SessionManager;
    use std::sync::Arc;
    use tempfile::TempDir;

    fn test_model() -> Model {
        Model::new(Provider::Custom, "test-model")
    }

    fn test_config() -> super::super::SessionConfig {
        super::super::SessionConfig {
            model: test_model(),
            system_prompt: None,
            max_turns: None,
            max_tokens: None,
            temperature: None,
            api_key: None,
        }
    }

    #[tokio::test]
    async fn test_fs_create_load_save() {
        let tmp = TempDir::new().unwrap();
        let store = FileSystemSessionStore::new(tmp.path());
        let mgr = SessionManager::new(Arc::new(store));

        let mut session = mgr
            .create(test_config(), Some("user-1".into()))
            .await
            .unwrap();
        mgr.append_message(&mut session, Message::User(UserMessage::text("hello")));
        mgr.save(&mut session).await.unwrap();

        let loaded = mgr.load(&session.id).await.unwrap().unwrap();
        assert_eq!(loaded.entries.len(), 1);
        assert_eq!(loaded.metadata.user_id, Some("user-1".into()));
    }

    #[tokio::test]
    async fn test_fs_delete() {
        let tmp = TempDir::new().unwrap();
        let store = FileSystemSessionStore::new(tmp.path());
        let mgr = SessionManager::new(Arc::new(store));

        let session = mgr.create(test_config(), None).await.unwrap();
        assert!(mgr.delete(&session.id).await.unwrap());
        assert!(mgr.load(&session.id).await.unwrap().is_none());
        assert!(!mgr.delete("nonexistent").await.unwrap());
    }

    #[tokio::test]
    async fn test_fs_list_with_filter() {
        let tmp = TempDir::new().unwrap();
        let store = FileSystemSessionStore::new(tmp.path());
        let mgr = SessionManager::new(Arc::new(store));

        mgr.create(test_config(), Some("u1".into())).await.unwrap();
        mgr.create(test_config(), Some("u2".into())).await.unwrap();
        mgr.create(test_config(), Some("u1".into())).await.unwrap();

        let all = mgr.list(&SessionFilter::default()).await.unwrap();
        assert_eq!(all.len(), 3);

        let filtered = mgr
            .list(&SessionFilter {
                user_id: Some("u1".into()),
                ..Default::default()
            })
            .await
            .unwrap();
        assert_eq!(filtered.len(), 2);
    }
}
