/** Thinking effort levels per provider/model family.
 *  Based on opencode's ProviderTransform.variants() logic. */
const PROVIDER_EFFORTS: Record<string, string[]> = {
  // Anthropic Claude 4.6+: adaptive thinking with effort
  anthropic: ["none", "low", "medium", "high", "max"],
  // OpenAI: reasoning_effort parameter
  openai: ["none", "low", "medium", "high"],
  // DeepSeek: thinking budget
  deepseek: ["none", "low", "medium", "high", "max"],
  // Google Gemini
  google: ["none", "low", "medium", "high", "max"],
  // xAI Grok
  xai: ["none", "low", "medium", "high"],
  // Groq
  groq: ["none", "low", "medium", "high"],
  // Generic fallback
  default: ["none", "high"],
}

const CUSTOM_PROVIDER_EFFORTS = ["none", "low", "medium", "high"]

function normalizeProvider(provider: string): string {
  const p = provider.toLowerCase()
  if (p.includes("anthropic")) return "anthropic"
  if (p.includes("openai") || p === "openrouter") return "openai"
  if (p.includes("deepseek")) return "deepseek"
  if (p.includes("google")) return "google"
  if (p.includes("xai") || p.includes("grok")) return "xai"
  if (p.includes("groq")) return "groq"
  return "default"
}

/** Get the available thinking effort levels for a given provider. */
export function getProviderEfforts(provider: string): string[] {
  const key = normalizeProvider(provider)
  const efforts = PROVIDER_EFFORTS[key]
  if (efforts) return efforts
  return CUSTOM_PROVIDER_EFFORTS
}

/**
 * Cycle to the next thinking effort level.
 * Returns the next effort string, or undefined if no valid levels found.
 */
export function cycleEffort(
  provider: string,
  currentEffort?: string,
): string | undefined {
  const efforts = getProviderEfforts(provider)
  if (efforts.length <= 1) return undefined

  const idx = currentEffort ? efforts.indexOf(currentEffort) : -1
  if (idx === -1 || idx >= efforts.length - 1) {
    return efforts[0]
  }
  return efforts[idx + 1]
}

/** Get a display label for the current thinking effort. */
export function getEffortLabel(effort?: string): string {
  if (!effort || effort === "none") return "default"
  return effort
}
