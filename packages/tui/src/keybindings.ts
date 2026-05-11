import { type KeyId, matchesKey } from "./keys.js";

export interface Keybinding {
  key: KeyId;
  description: string;
  when?: string;
  action: string;
}

export interface KeybindingHandler {
  (action: string, context: Record<string, unknown>): boolean | void;
}

export class KeybindingsManager {
  private bindings: Map<string, Keybinding[]> = new Map();
  private handler: KeybindingHandler | null = null;
  private contexts: Map<string, boolean> = new Map();

  add(binding: Keybinding): void {
    const scope = binding.when ?? "__global__";
    if (!this.bindings.has(scope)) this.bindings.set(scope, []);
    this.bindings.get(scope)!.push(binding);
  }

  remove(action: string, scope?: string): void {
    const s = scope ?? "__global__";
    const list = this.bindings.get(s);
    if (list) {
      const filtered = list.filter((b) => b.action !== action);
      this.bindings.set(s, filtered);
    }
  }

  setHandler(handler: KeybindingHandler): void {
    this.handler = handler;
  }

  setContext(name: string, active: boolean): void {
    this.contexts.set(name, active);
  }

  handleInput(data: string, extraContext?: Record<string, unknown>): boolean {
    const order = ["__global__"];
    for (const [name, active] of this.contexts) {
      if (active) order.push(name);
    }

    for (const scope of order) {
      const list = this.bindings.get(scope);
      if (!list) continue;
      for (const binding of list) {
        if (matchesKey(data, binding.key)) {
          if (this.handler) {
            const result = this.handler(binding.action, extraContext ?? {});
            if (result !== false) return true;
          }
          return true;
        }
      }
    }
    return false;
  }

  getBindings(scope?: string): Keybinding[] {
    if (scope) return this.bindings.get(scope) ?? [];
    const all: Keybinding[] = [];
    for (const list of this.bindings.values()) all.push(...list);
    return all;
  }
}