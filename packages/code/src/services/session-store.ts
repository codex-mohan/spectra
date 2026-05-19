import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, unlinkSync } from "fs";
import { join } from "path";
import { getGlobalDataDir } from "../utils/paths.js";
import type { Message } from "@singularity-ai/spectra-ai";

export interface SessionInfo {
  id: string;
  title: string;
  agent: string;
  model: string;
  provider: string;
  created: number;
  updated: number;
  messageCount: number;
  directory: string;
}

export interface SessionData {
  id: string;
  title: string;
  agent: string;
  model: string;
  provider: string;
  created: number;
  updated: number;
  directory: string;
  messages: Message[];
}

export class SessionStore {
  private dataDir: string;

  constructor(dataDir?: string) {
    this.dataDir = dataDir || join(getGlobalDataDir(), "sessions");
    if (!existsSync(this.dataDir)) {
      mkdirSync(this.dataDir, { recursive: true });
    }
  }

  private sessionPath(id: string): string {
    return join(this.dataDir, `${id}.json`);
  }

  private generateId(): string {
    return Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
  }

  list(dir?: string): SessionInfo[] {
    const files = readdirSync(this.dataDir);
    const sessions: SessionInfo[] = [];

    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      try {
        const data = JSON.parse(readFileSync(join(this.dataDir, file), "utf-8")) as SessionData;
        if (dir && data.directory !== dir) continue;
        sessions.push({
          id: data.id, title: data.title, agent: data.agent,
          model: data.model, provider: data.provider || "",
          created: data.created, updated: data.updated,
          messageCount: data.messages.length, directory: data.directory,
        });
      } catch { }
    }

    sessions.sort((a, b) => b.updated - a.updated);
    return sessions;
  }

  get(id: string): SessionData | null {
    const path = this.sessionPath(id);
    if (!existsSync(path)) return null;
    try {
      return JSON.parse(readFileSync(path, "utf-8"));
    } catch {
      return null;
    }
  }

  create(input: { title?: string; agent?: string; model?: string; provider?: string; directory?: string }): SessionData {
    const session: SessionData = {
      id: this.generateId(),
      title: input.title || "New Session",
      agent: input.agent || "build",
      model: input.model || "",
      provider: input.provider || input.model?.split("/")[0] || "",
      created: Date.now(),
      updated: Date.now(),
      directory: input.directory || process.cwd(),
      messages: [],
    };
    this.save(session);
    return session;
  }

  save(session: SessionData): void {
    session.updated = Date.now();
    writeFileSync(this.sessionPath(session.id), JSON.stringify(session, null, 2));
  }

  delete(id: string): boolean {
    const path = this.sessionPath(id);
    if (!existsSync(path)) return false;
    unlinkSync(path);
    return true;
  }

  rename(id: string, title: string): boolean {
    const session = this.get(id);
    if (!session) return false;
    session.title = title;
    this.save(session);
    return true;
  }

  fork(id: string): SessionData | null {
    const original = this.get(id);
    if (!original) return null;
    const forked: SessionData = {
      ...original,
      id: this.generateId(),
      title: `${original.title} (fork)`,
      created: Date.now(),
      updated: Date.now(),
      messages: [...original.messages],
    };
    this.save(forked);
    return forked;
  }

  archive(id: string): boolean {
    const session = this.get(id);
    if (!session) return false;
    const path = this.sessionPath(id);
    const archiveDir = join(this.dataDir, "archived");
    if (!existsSync(archiveDir)) mkdirSync(archiveDir, { recursive: true });
    const archivePath = join(archiveDir, `${id}.json`);
    writeFileSync(archivePath, JSON.stringify(session, null, 2));
    unlinkSync(path);
    return true;
  }

  addMessage(sessionId: string, message: Message): SessionData | null {
    const session = this.get(sessionId);
    if (!session) return null;
    session.messages.push(message);
    session.updated = Date.now();
    if (session.messages.length === 1) {
      session.title = message.role === "user"
        ? (typeof message.content === "string" ? message.content.slice(0, 60) : "User message")
        : session.title;
    }
    this.save(session);
    return session;
  }
}
