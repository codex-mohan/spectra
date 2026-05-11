import type { ExtensionEventListener } from "./types.js";

type Listener = ExtensionEventListener;

export class EventBus {
  private listeners = new Map<string, Set<Listener>>();

  on(eventType: string, listener: Listener): () => void {
    if (!this.listeners.has(eventType)) {
      this.listeners.set(eventType, new Set());
    }
    this.listeners.get(eventType)!.add(listener);
    return () => this.off(eventType, listener);
  }

  off(eventType: string, listener: Listener): void {
    const set = this.listeners.get(eventType);
    if (set) {
      set.delete(listener);
      if (set.size === 0) this.listeners.delete(eventType);
    }
  }

  emit(eventType: string, data: unknown): void {
    const set = this.listeners.get(eventType);
    if (!set) return;
    for (const listener of set) {
      try {
        listener(data);
      } catch {
        // swallow errors in event listeners
      }
    }
  }

  removeAllListeners(eventType?: string): void {
    if (eventType) {
      this.listeners.delete(eventType);
    } else {
      this.listeners.clear();
    }
  }

  listenerCount(eventType: string): number {
    return this.listeners.get(eventType)?.size ?? 0;
  }
}