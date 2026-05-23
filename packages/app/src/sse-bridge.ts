import type { AgentEvent } from "@mohanscodex/spectra-agent";
import type {
  ConnectionBridge,
  ConnectionConfig,
  ConnectionTransport,
  EngineEvent,
} from "./types.js";

interface SseClient {
  id: string;
  write(data: string): void;
  end(): void;
}

interface BridgeHandler {
  (event: EngineEvent): void;
}

export class SseBridge implements ConnectionBridge {
  readonly transport: ConnectionTransport = "sse";
  private clients = new Map<string, SseClient>();
  private handlers: BridgeHandler[] = [];
  private heartbeatTimer?: ReturnType<typeof setInterval>;
  private config: Omit<Required<ConnectionConfig>, "cors"> & { cors: { origin: string | string[] } };

  constructor(config?: ConnectionConfig) {
    this.config = {
      transport: "sse",
      heartbeatIntervalMs: config?.heartbeatIntervalMs ?? 15000,
      reconnectTimeoutMs: config?.reconnectTimeoutMs ?? 5000,
      maxReconnectAttempts: config?.maxReconnectAttempts ?? 5,
      cors: (config?.cors ?? { origin: "*" }) as { origin: string | string[] },
    };

    if (this.config.heartbeatIntervalMs > 0) {
      this.heartbeatTimer = setInterval(() => {
        this.broadcast(": heartbeat\n\n");
      }, this.config.heartbeatIntervalMs);
    }
  }

  addClient(clientId: string): SseWriter {
    const self: SseClient[] = [null as unknown as SseClient];

    const writer: SseWriter = {
      write: (data: string) => {
        for (const handler of this.handlers) {
          handler({
            type: "connection_open",
            data: { clientId, data },
            timestamp: Date.now(),
          });
        }
      },
      end: () => {
        this.clients.delete(clientId);
        for (const handler of this.handlers) {
          handler({
            type: "connection_close",
            data: { clientId },
            timestamp: Date.now(),
          });
        }
      },
      clientId,
    };

    const client: SseClient = {
      id: clientId,
      write: (data: string) => writer.write(data),
      end: () => writer.end(),
    };

    this.clients.set(clientId, client);

    return writer;
  }

  removeClient(clientId: string): void {
    this.clients.delete(clientId);
  }

  attach(handler: BridgeHandler): void {
    this.handlers.push(handler);
  }

  detach(handler: BridgeHandler): void {
    this.handlers = this.handlers.filter((h) => h !== handler);
  }

  send(event: EngineEvent): void {
    this.broadcast(this.formatSse(event));
  }

  async close(): Promise<void> {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
    }

    for (const [id, client] of this.clients) {
      client.end();
    }
    this.clients.clear();
    this.handlers = [];
  }

  serializeEvent(event: EngineEvent): string {
    return this.formatSse(event);
  }

  getReconnectInfo(): { timeout: number; maxAttempts: number } {
    return {
      timeout: this.config.reconnectTimeoutMs,
      maxAttempts: this.config.maxReconnectAttempts,
    };
  }

  private formatSse(event: EngineEvent): string {
    const eventType = event.type;
    const data = JSON.stringify(event.data ?? {});

    let message = `event: ${eventType}\ndata: ${data}\n\n`;

    if (eventType === "agent_event") {
      const agentEvent = event.data as AgentEvent;
      if (agentEvent) {
        message = `event: ${agentEvent.type}\ndata: ${data}\n\n`;
      }
    }

    return message;
  }

  private broadcast(data: string): void {
    for (const client of this.clients.values()) {
      client.write(data);
    }
  }
}

export interface SseWriter {
  write(data: string): void;
  end(): void;
  clientId: string;
}

export function createSseResponse(
  bridge: SseBridge,
  request: { headers: { get(name: string): string | null } }
): {
  body: ReadableStream<Uint8Array>;
  headers: Record<string, string>;
  status: number;
} | null {
  const reconnect = bridge.getReconnectInfo();
  const retryHeader = `retry: ${reconnect.timeout}\n\n`;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const clientId = `sse-${Math.random().toString(36).slice(2, 10)}`;
      const writer = bridge.addClient(clientId);

      controller.enqueue(new TextEncoder().encode(retryHeader));
      controller.enqueue(
        new TextEncoder().encode(`event: connected\ndata: {"clientId":"${clientId}"}\n\n`)
      );

      const originalWrite = writer.write;
      writer.write = (data: string) => {
        try {
          controller.enqueue(new TextEncoder().encode(data));
          originalWrite(data);
        } catch {
          bridge.removeClient(clientId);
        }
      };

      const originalEnd = writer.end;
      writer.end = () => {
        try {
          controller.close();
        } catch {}
        originalEnd();
      };

      request.headers.get("x-request-id");
    },
    cancel() {},
  });

  return {
    body: stream,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
      ...(request.headers.get("origin")
        ? { "Access-Control-Allow-Origin": request.headers.get("origin")! }
        : {}),
      "Access-Control-Allow-Credentials": "true",
    },
    status: 200,
  };
}
