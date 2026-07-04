use super::{Session, SessionFilter, SessionStatus, SessionStore};
use crate::error::{Result, SpectraError};
use async_trait::async_trait;
use parking_lot::Mutex;
use rusqlite::{Connection, ToSql, params, types::Value as SqlValue};
use std::path::Path;
use std::sync::Arc;

pub struct SQLiteSessionStore {
    conn: Arc<Mutex<Connection>>,
}

impl SQLiteSessionStore {
    pub fn new(path: impl AsRef<Path>) -> Result<Self> {
        let path = path.as_ref();
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let conn = Connection::open(path)?;
        conn.execute_batch(
            "PRAGMA journal_mode = WAL;
             PRAGMA foreign_keys = ON;
             CREATE TABLE IF NOT EXISTS sessions (
                 id TEXT PRIMARY KEY,
                 model TEXT NOT NULL,
                 config TEXT NOT NULL,
                 metadata TEXT NOT NULL,
                 entries TEXT NOT NULL,
                 created_at INTEGER NOT NULL,
                 updated_at INTEGER NOT NULL
             );
             CREATE INDEX IF NOT EXISTS idx_sessions_updated ON sessions(updated_at DESC);
             CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(json_extract(metadata, '$.userId'));
             CREATE INDEX IF NOT EXISTS idx_sessions_tenant ON sessions(json_extract(metadata, '$.tenantId'));",
        )?;
        Ok(Self {
            conn: Arc::new(Mutex::new(conn)),
        })
    }

    async fn with_conn<T, F>(&self, f: F) -> Result<T>
    where
        T: Send + 'static,
        F: FnOnce(&Connection) -> Result<T> + Send + 'static,
    {
        let conn = Arc::clone(&self.conn);
        tokio::task::spawn_blocking(move || {
            let conn = conn.lock();
            f(&conn)
        })
        .await
        .map_err(|e| SpectraError::ConfigError {
            field: "sqlite".into(),
            detail: format!("SQLite worker task failed: {e}"),
        })?
    }
}

#[async_trait]
impl SessionStore for SQLiteSessionStore {
    async fn create(&self, session: Session) -> Result<Session> {
        let id = session.id.clone();
        let model = serde_json::to_string(&session.model)?;
        let config = serde_json::to_string(&session.config)?;
        let metadata = serde_json::to_string(&session.metadata)?;
        let entries = serde_json::to_string(&session.entries)?;
        let now = chrono::Utc::now().timestamp_millis();

        self.with_conn(move |conn| {
            conn.execute(
                "INSERT INTO sessions (id, model, config, metadata, entries, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![id, model, config, metadata, entries, now, now],
            )?;
            Ok(())
        })
        .await?;

        Ok(session)
    }

    async fn load(&self, id: &str) -> Result<Option<Session>> {
        let id = id.to_string();
        self.with_conn(move |conn| {
            let mut stmt = conn
                .prepare("SELECT model, config, metadata, entries FROM sessions WHERE id = ?1")?;
            let result = stmt.query_row(params![id], |row| {
                let model_json: String = row.get(0)?;
                let config_json: String = row.get(1)?;
                let metadata_json: String = row.get(2)?;
                let entries_json: String = row.get(3)?;
                Ok((model_json, config_json, metadata_json, entries_json))
            });

            match result {
                Ok((model_json, config_json, metadata_json, entries_json)) => {
                    let session = Session {
                        id,
                        model: serde_json::from_str(&model_json)?,
                        entries: serde_json::from_str(&entries_json)?,
                        config: serde_json::from_str(&config_json)?,
                        metadata: serde_json::from_str(&metadata_json)?,
                    };
                    Ok(Some(session))
                }
                Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
                Err(e) => Err(e.into()),
            }
        })
        .await
    }

    async fn save(&self, session: &Session) -> Result<()> {
        let id = session.id.clone();
        let model = serde_json::to_string(&session.model)?;
        let config = serde_json::to_string(&session.config)?;
        let metadata = serde_json::to_string(&session.metadata)?;
        let entries = serde_json::to_string(&session.entries)?;
        let now = chrono::Utc::now().timestamp_millis();

        self.with_conn(move |conn| {
            conn.execute(
                "INSERT INTO sessions (id, model, config, metadata, entries, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
                 ON CONFLICT(id) DO UPDATE SET
                     model = excluded.model,
                     config = excluded.config,
                     metadata = excluded.metadata,
                     entries = excluded.entries,
                     updated_at = excluded.updated_at",
                params![id, model, config, metadata, entries, now, now],
            )?;
            Ok(())
        })
        .await
    }

    async fn delete(&self, id: &str) -> Result<bool> {
        let id = id.to_string();
        self.with_conn(move |conn| {
            let changed = conn.execute("DELETE FROM sessions WHERE id = ?1", params![id])?;
            Ok(changed > 0)
        })
        .await
    }

    async fn list(&self, filter: &SessionFilter) -> Result<Vec<Session>> {
        let filter = filter.clone();
        self.with_conn(move |conn| {
            let mut sql = String::from("SELECT id, model, config, metadata, entries FROM sessions");
            let mut conditions = Vec::new();
            let mut param_values: Vec<SqlValue> = Vec::new();

            if let Some(uid) = &filter.user_id {
                conditions.push("json_extract(metadata, '$.userId') = ?");
                param_values.push(SqlValue::Text(uid.clone()));
            }
            if let Some(tid) = &filter.tenant_id {
                conditions.push("json_extract(metadata, '$.tenantId') = ?");
                param_values.push(SqlValue::Text(tid.clone()));
            }
            if let Some(status) = &filter.status {
                match status {
                    SessionStatus::Active => {
                        conditions.push("json_extract(metadata, '$.isStreaming') = 1");
                    }
                    SessionStatus::Completed => {
                        conditions.push("json_extract(metadata, '$.isStreaming') = 0");
                        conditions.push("json_type(metadata, '$.error') IS NULL");
                    }
                    SessionStatus::Error => {
                        conditions.push("json_type(metadata, '$.error') IS NOT NULL");
                    }
                }
            }

            if !conditions.is_empty() {
                sql.push_str(" WHERE ");
                sql.push_str(&conditions.join(" AND "));
            }
            sql.push_str(" ORDER BY updated_at DESC");

            if let Some(limit) = filter.limit {
                sql.push_str(" LIMIT ?");
                param_values.push(SqlValue::Integer(limit as i64));
            }
            if let Some(offset) = filter.offset {
                if filter.limit.is_none() {
                    sql.push_str(" LIMIT -1");
                }
                sql.push_str(" OFFSET ?");
                param_values.push(SqlValue::Integer(offset as i64));
            }

            let param_refs: Vec<&dyn ToSql> =
                param_values.iter().map(|p| p as &dyn ToSql).collect();
            let mut stmt = conn.prepare(&sql)?;
            let rows = stmt.query_map(param_refs.as_slice(), |row| {
                let id: String = row.get(0)?;
                let model_json: String = row.get(1)?;
                let config_json: String = row.get(2)?;
                let metadata_json: String = row.get(3)?;
                let entries_json: String = row.get(4)?;
                Ok((id, model_json, config_json, metadata_json, entries_json))
            })?;

            let mut sessions = Vec::new();
            for row in rows {
                let (id, model_json, config_json, metadata_json, entries_json) = row?;
                sessions.push(Session {
                    id,
                    model: serde_json::from_str(&model_json)?,
                    entries: serde_json::from_str(&entries_json)?,
                    config: serde_json::from_str(&config_json)?,
                    metadata: serde_json::from_str(&metadata_json)?,
                });
            }

            Ok(sessions)
        })
        .await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::llm::{Model, Provider};
    use crate::messages::{Message, UserMessage};
    use crate::session::{SessionConfig, SessionManager};
    use std::sync::Arc;
    use tempfile::TempDir;

    fn test_model() -> Model {
        Model::new(Provider::Custom, "test-model")
    }

    fn test_config() -> SessionConfig {
        SessionConfig {
            model: test_model(),
            system_prompt: None,
            max_turns: None,
            max_tokens: None,
            temperature: None,
            api_key: None,
        }
    }

    #[tokio::test]
    async fn test_sqlite_create_load_save() {
        let tmp = TempDir::new().unwrap();
        let db_path = tmp.path().join("test.db");
        let store = SQLiteSessionStore::new(&db_path).unwrap();
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
    async fn test_sqlite_delete() {
        let tmp = TempDir::new().unwrap();
        let db_path = tmp.path().join("test.db");
        let store = SQLiteSessionStore::new(&db_path).unwrap();
        let mgr = SessionManager::new(Arc::new(store));

        let session = mgr.create(test_config(), None).await.unwrap();
        assert!(mgr.delete(&session.id).await.unwrap());
        assert!(mgr.load(&session.id).await.unwrap().is_none());
        assert!(!mgr.delete("nonexistent").await.unwrap());
    }

    #[tokio::test]
    async fn test_sqlite_list_with_filter() {
        let tmp = TempDir::new().unwrap();
        let db_path = tmp.path().join("test.db");
        let store = SQLiteSessionStore::new(&db_path).unwrap();
        let mgr = SessionManager::new(Arc::new(store));

        mgr.create_with_tenant(test_config(), Some("u1".into()), Some("t1".into()))
            .await
            .unwrap();
        mgr.create_with_tenant(test_config(), Some("u2".into()), Some("t1".into()))
            .await
            .unwrap();
        mgr.create_with_tenant(test_config(), Some("u1".into()), Some("t2".into()))
            .await
            .unwrap();

        let all = mgr.list(&SessionFilter::default()).await.unwrap();
        assert_eq!(all.len(), 3);

        let user_filtered = mgr
            .list(&SessionFilter {
                user_id: Some("u1".into()),
                ..Default::default()
            })
            .await
            .unwrap();
        assert_eq!(user_filtered.len(), 2);

        let tenant_filtered = mgr
            .list(&SessionFilter {
                tenant_id: Some("t1".into()),
                ..Default::default()
            })
            .await
            .unwrap();
        assert_eq!(tenant_filtered.len(), 2);

        let combined = mgr
            .list(&SessionFilter {
                user_id: Some("u1".into()),
                tenant_id: Some("t1".into()),
                ..Default::default()
            })
            .await
            .unwrap();
        assert_eq!(combined.len(), 1);
    }

    #[tokio::test]
    async fn test_sqlite_upsert_on_save() {
        let tmp = TempDir::new().unwrap();
        let db_path = tmp.path().join("test.db");
        let store = SQLiteSessionStore::new(&db_path).unwrap();
        let mgr = SessionManager::new(Arc::new(store));

        let mut session = mgr.create(test_config(), None).await.unwrap();
        mgr.append_message(&mut session, Message::User(UserMessage::text("first")));
        mgr.save(&mut session).await.unwrap();

        mgr.append_message(&mut session, Message::User(UserMessage::text("second")));
        mgr.save(&mut session).await.unwrap();

        let loaded = mgr.load(&session.id).await.unwrap().unwrap();
        assert_eq!(loaded.entries.len(), 2);
    }
}
