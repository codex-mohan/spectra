import { registerProvider } from "../registry.js";
import { createAnthropicProvider } from "./anthropic.js";

export function initProviders(): void {
  registerProvider(createAnthropicProvider());
}

initProviders();
