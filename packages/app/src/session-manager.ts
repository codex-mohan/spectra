import { v4 as uuidv4 } from "uuid";
import type {
  Session,
  SessionConfig,
  SessionStore,
  SessionFilter,
  SessionEntry,
  SessionTreeNode,
  MessageEntry,
  AuditEntry,
  CustomEntry,
  ModelChangeEntry,
  SessionContext,
} from "./types.js";
import type { Message, Model } from "@mohanscodex/spectra-ai";

function generateId(): string {
  return uuidv4();
}

/** Find the entry with no children (the leaf) */
function findLeafId(entries: SessionEntry[]): string | null {
  if (entries.length === 0) return null;
  const allIds = new Set(entries.map((e) => e.id));
  for (const e of entries) {
    if (!allIds.has(e.parentId ?? "")) {
      // This entry is not a parent of anyone — it's a leaf
      // But there could be multiple, so just return the last one
    }
  }
  // The last entry is treated as the leaf
  return entries[entries.length - 1]?.id ?? null;
}

/** Build a tree from flat entries */
function buildTree(entries: SessionEntry[]): SessionTreeNode[] {
  const nodes = new Map<string, SessionTreeNode>();
  const roots: SessionTreeNode[] = [];

  for (const entry of entries) {
    nodes.set(entry.id, { entry, children: [] });
  }

  for (const entry of entries) {
    const node = nodes.get(entry.id)!;
    if (entry.parentId) {
      const parent = nodes.get(entry.parentId);
      if (parent) {
        parent.children.push(node);
      } else {
        roots.push(node);
      }
    } else {
      roots.push(node);
    }
  }

  return roots;
}

/** Get the linear branch from root to the given entry */
function getBranchPath(
  entries: SessionEntry[],
  entryId?: string
): SessionEntry[] {
  if (entries.length === 0) return [];

  const byId = new Map(entries.map((e) => [e.id, e]));
  const targetId = entryId ?? entries[entries.length - 1].id;

  const path: SessionEntry[] = [];
  let current = byId.get(targetId);

  while (current) {
    path.unshift(current);
    if (!current.parentId) break;
    current = byId.get(current.parentId);
  }

  return path;
}

export class SessionManager {
  constructor(private store: SessionStore) {}

  async create(config: SessionConfig, userId?: string): Promise<Session> {
    const session: Session = {
      id: generateId(),
      model: config.model,
      entries: [],
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

  /** Append an entry to the session. Auto-generates id and wires parentId to current leaf. */
  appendEntry(
    session: Session,
    entry:
      | Omit<MessageEntry, "id" | "parentId" | "timestamp">
      | Omit<ModelChangeEntry, "id" | "parentId" | "timestamp">
      | Omit<AuditEntry, "id" | "parentId" | "timestamp">
      | Omit<CustomEntry, "id" | "parentId" | "timestamp">
  ): SessionEntry {
    const id = generateId();
    const leafId = findLeafId(session.entries);
    const fullEntry: SessionEntry = {
      ...entry,
      id,
      parentId: leafId,
      timestamp: Date.now(),
    } as unknown as SessionEntry;

    session.entries.push(fullEntry);
    return fullEntry;
  }

  /** Append a message entry. */
  appendMessage(session: Session, message: Message): MessageEntry {
    return this.appendEntry(session, { type: "message", message }) as MessageEntry;
  }

  /** Append an audit event entry. */
  appendAudit(session: Session, eventType: string, details: Record<string, unknown>): AuditEntry {
    return this.appendEntry(session, { type: "audit", eventType, details }) as AuditEntry;
  }

  /** Append a custom extension entry. */
  appendCustom(session: Session, customType: string, data: unknown): CustomEntry {
    return this.appendEntry(session, { type: "custom", customType, data }) as CustomEntry;
  }

  /** Append a model change entry and update session.model. */
  appendModelChange(session: Session, model: Model): ModelChangeEntry {
    const entry = this.appendEntry(session, {
      type: "model_change",
      provider: model.provider,
      modelId: model.id,
    }) as ModelChangeEntry;
    session.model = model;
    return entry;
  }

  /** Get the linear branch from root to the specified entry (or current leaf). */
  getBranch(session: Session, entryId?: string): SessionEntry[] {
    return getBranchPath(session.entries, entryId);
  }

  /** Get the full tree structure of the session. */
  getTree(session: Session): SessionTreeNode[] {
    return buildTree(session.entries);
  }

  /** Get the id of the current leaf entry. */
  getLeafId(session: Session): string | null {
    return findLeafId(session.entries);
  }

  /** Build LLM-ready context from message entries in the branch. */
  buildContext(session: Session, entryId?: string): SessionContext {
    const branch = this.getBranch(session, entryId);
    const messages = branch
      .filter((e): e is MessageEntry => e.type === "message")
      .map((e) => e.message);

    return {
      messages,
      model: session.model,
    };
  }

  /** Fork a session from any entry point. */
  async fork(sourceId: string, branchFromEntryId?: string): Promise<Session> {
    const source = await this.store.load(sourceId);
    if (!source) {
      throw new Error(`Source session not found: ${sourceId}`);
    }

    const branch = this.getBranch(source, branchFromEntryId);

    const forked: Session = {
      id: generateId(),
      model: source.model,
      entries: branch.map((e) => ({ ...e })), // shallow copy entries
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
