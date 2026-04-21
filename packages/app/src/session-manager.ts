import { v4 as uuidv4 } from "uuid";
import type {
  Session,
  SessionConfig,
  SessionStore,
  SessionFilter,
} from "./types.js";

export class SessionManager {
  constructor(private store: SessionStore) {}

  async create(config: SessionConfig, userId?: string): Promise<Session> {
    const session: Session = {
      id: uuidv4(),
      model: config.model,
      messages: [],
      config,
      metadata: {
        createdAt: new Date(),
        updatedAt: new Date(),
        turnCount: 0,
        tokenUsage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 },
        isStreaming: false,
        userId,
      },
    };

    await this.store.create(session);
    return session;
  }

  async load(id: string): Promise<Session | null> {
    return this.store.load(id);
  }

  async save(session: Session): Promise<void> {
    session.metadata.updatedAt = new Date();
    await this.store.save(session);
  }

  async delete(id: string): Promise<void> {
    await this.store.delete(id);
  }

  async list(filter?: SessionFilter): Promise<Session[]> {
    return this.store.list(filter);
  }

  async fork(sourceId: string, branchFromIndex?: number): Promise<Session> {
    const source = await this.store.load(sourceId);
    if (!source) {
      throw new Error(`Source session not found: ${sourceId}`);
    }

    const forked: Session = {
      id: uuidv4(),
      model: source.model,
      messages: source.messages.slice(0, (branchFromIndex ?? source.messages.length - 1) + 1),
      config: { ...source.config },
      metadata: {
        createdAt: new Date(),
        updatedAt: new Date(),
        turnCount: 0,
        tokenUsage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 },
        isStreaming: false,
        parentSessionId: sourceId,
        userId: source.metadata.userId,
      },
    };

    await this.store.create(forked);
    return forked;
  }
}
