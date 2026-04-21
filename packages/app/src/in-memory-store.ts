import type { Session, SessionFilter, SessionStore } from "./types.js";

export class InMemorySessionStore implements SessionStore {
  private sessions = new Map<string, Session>();

  async create(session: Session): Promise<Session> {
    this.sessions.set(session.id, session);
    return session;
  }

  async load(id: string): Promise<Session | null> {
    return this.sessions.get(id) ?? null;
  }

  async save(session: Session): Promise<void> {
    this.sessions.set(session.id, session);
  }

  async delete(id: string): Promise<void> {
    this.sessions.delete(id);
  }

  async list(filter?: SessionFilter): Promise<Session[]> {
    let sessions = Array.from(this.sessions.values());

    if (filter?.userId) {
      sessions = sessions.filter((s) => s.metadata.userId === filter.userId);
    }

    if (filter?.status) {
      sessions = sessions.filter((s) => {
        if (filter.status === "active") return s.metadata.isStreaming;
        if (filter.status === "completed") return !s.metadata.isStreaming && !s.metadata.error;
        if (filter.status === "error") return s.metadata.error;
        return true;
      });
    }

    if (filter?.limit) {
      sessions = sessions.slice(0, filter.limit);
    }

    return sessions;
  }
}
