import { readFile, writeFile, mkdir, readdir, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";

export interface SessionMessage {
  id: string;
  role: "user" | "assistant" | "toolResult" | "system";
  content: string;
  toolName?: string;
  toolCallId?: string;
  isError?: boolean;
  timestamp: number;
}

export interface Session {
  id: string;
  model: string;
  createdAt: number;
  updatedAt: number;
  messages: SessionMessage[];
}

function generateSessionId(): string {
  return `session_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export async function ensureSessionDir(sessionDir: string): Promise<void> {
  if (!existsSync(sessionDir)) {
    await mkdir(sessionDir, { recursive: true });
  }
}

export async function saveSession(sessionDir: string, session: Session): Promise<void> {
  await ensureSessionDir(sessionDir);
  session.updatedAt = Date.now();
  const filePath = join(sessionDir, `${session.id}.jsonl`);
  const lines = session.messages.map((m) => JSON.stringify(m));
  await writeFile(filePath, lines.join("\n"), "utf-8");
}

export async function loadSession(sessionDir: string, sessionId: string): Promise<Session | null> {
  const filePath = join(sessionDir, `${sessionId}.jsonl`);
  if (!existsSync(filePath)) return null;

  try {
    const raw = await readFile(filePath, "utf-8");
    const messages: SessionMessage[] = raw
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line));
    const statResult = await stat(filePath);
    return {
      id: sessionId,
      model: "",
      createdAt: statResult.birthtimeMs,
      updatedAt: statResult.mtimeMs,
      messages,
    };
  } catch {
    return null;
  }
}

export async function listSessions(sessionDir: string): Promise<Array<{ id: string; updatedAt: number }>> {
  if (!existsSync(sessionDir)) return [];

  const entries = await readdir(sessionDir);
  const sessions: Array<{ id: string; updatedAt: number }> = [];

  for (const entry of entries) {
    if (!entry.endsWith(".jsonl")) continue;
    const filePath = join(sessionDir, entry);
    try {
      const statResult = await stat(filePath);
      sessions.push({
        id: entry.replace(".jsonl", ""),
        updatedAt: statResult.mtimeMs,
      });
    } catch { /* skip */ }
  }

  sessions.sort((a, b) => b.updatedAt - a.updatedAt);
  return sessions;
}

export async function deleteSession(sessionDir: string, sessionId: string): Promise<void> {
  const filePath = join(sessionDir, `${sessionId}.jsonl`);
  if (existsSync(filePath)) {
    await unlink(filePath);
  }
}

export function createSession(model: string): Session {
  return {
    id: generateSessionId(),
    model,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messages: [],
  };
}

export function addMessageToSession(session: Session, message: SessionMessage): Session {
  return {
    ...session,
    messages: [...session.messages, message],
    updatedAt: Date.now(),
  };
}