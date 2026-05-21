import { registerProvider, type Provider, type Model, type Context, type StreamOptions, AssistantMessageEventStream } from "@singularity-ai/spectra-ai"
import type { CustomProviderConfig } from "./config.js"
import { read } from "./auth-store.js"

function resolveApiKey(providerId: string, configApiKey?: string): string | undefined {
  if (configApiKey) return configApiKey
  const stored = read(providerId)
  if (stored?.type === "api") return stored.key
  return undefined
}

function parseStreamingJson(raw: string): Record<string, unknown> {
  try { return JSON.parse(raw) } catch { return {} }
}

function mapStopReason(reason: string | null): "stop" | "length" | "toolUse" | "error" | "aborted" {
  if (reason === null) return "stop"
  switch (reason) {
    case "stop": case "end": return "stop"
    case "length": return "length"
    case "function_call": case "tool_calls": return "toolUse"
    default: return reason === "content_filter" || reason === "network_error" ? "error" : "stop"
  }
}

interface OutputMessage {
  role: "assistant"
  content: any[]
  provider: string
  model: string
  responseId?: string
  usage: { input: number; output: number; cacheRead: number; cacheWrite: number; totalTokens: number }
  stopReason: "stop" | "length" | "toolUse" | "error" | "aborted"
  errorMessage?: string
  timestamp: number
}

export function registerCustomProvider(id: string, config: CustomProviderConfig): Provider {
  const provider: Provider = {
    name: id,
    listModels: () => {
      if (config.models) {
        return Object.entries(config.models).map(([modelId, meta]) => ({
          id: modelId,
          name: meta.name || modelId,
        }))
      }
      return []
    },
    stream(model: Model, context: Context, options?: StreamOptions): AssistantMessageEventStream {
      const stream = new AssistantMessageEventStream()

      const run = async () => {
        const output: OutputMessage = {
          role: "assistant",
          content: [],
          provider: model.provider,
          model: model.id,
          responseId: undefined,
          usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 },
          stopReason: "stop",
          timestamp: Date.now(),
        }

        try {
          const apiKey = options?.apiKey ?? resolveApiKey(id, config.apiKey)
          if (!apiKey) {
            output.stopReason = "error"
            output.errorMessage = `No API key for provider: ${id}`
            stream.push({ type: "start", partial: output as any })
            stream.push({ type: "error", reason: "error", error: output as any })
            stream.end()
            return
          }

          // Use the openai package from @singularity-ai/spectra-ai's dependencies
          // This avoids duplicating the openai dependency in packages/code
          const { default: OpenAI } = await import("@singularity-ai/spectra-ai").then(() => import("openai"))
          const client = new OpenAI({
            apiKey,
            baseURL: config.baseUrl,
            dangerouslyAllowBrowser: true,
            ...(config.headers ? { defaultHeaders: config.headers } : {}),
          })

          const messages: any[] = []
          if (context.systemPrompt) {
            messages.push({ role: "system", content: context.systemPrompt })
          }
          for (const msg of context.messages) {
            if (msg.role === "user") {
              messages.push({ role: "user", content: typeof msg.content === "string" ? msg.content : msg.content.map((c: any) => c.type === "text" ? { type: "text", text: c.text } : c) })
            } else if (msg.role === "assistant") {
              const text = msg.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("")
              const toolCalls = msg.content.filter((b: any) => b.type === "toolCall").map((tc: any) => ({
                id: tc.id, type: "function", function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
              }))
              if (text || toolCalls.length > 0) {
                messages.push({ role: "assistant", content: text || undefined, tool_calls: toolCalls.length > 0 ? toolCalls : undefined })
              }
            } else if (msg.role === "toolResult") {
              const text = msg.content.filter((c: any) => c.type === "text").map((c: any) => c.text).join("\n")
              messages.push({ role: "tool", content: text || "(no result)", tool_call_id: msg.toolCallId })
            }
          }

          const params: any = {
            model: model.id,
            messages,
            stream: true,
            stream_options: { include_usage: true },
          }

          if (options?.maxTokens) params.max_completion_tokens = options.maxTokens
          if (options?.temperature !== undefined) params.temperature = options.temperature
          if (context.tools) {
            params.tools = context.tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } }))
          }

          const openaiStream = await client.chat.completions.create(params, { signal: options?.signal }) as unknown as AsyncIterable<any>
          stream.push({ type: "start", partial: output as any })

          let currentBlock: any = null
          const blocks = output.content
          const blockIndex = () => blocks.length - 1

          for await (const chunk of openaiStream) {
            if (!chunk || typeof chunk !== "object") continue
            output.responseId = output.responseId || chunk.id
            if (chunk.usage) {
              const pu = chunk.usage
              const cached = pu.prompt_tokens_details?.cached_tokens || 0
              const cw = pu.prompt_tokens_details?.cache_write_tokens || 0
              output.usage = {
                input: Math.max(0, (pu.prompt_tokens || 0) - cached - cw),
                output: pu.completion_tokens || 0,
                cacheRead: cached,
                cacheWrite: cw,
                totalTokens: (pu.prompt_tokens || 0) + (pu.completion_tokens || 0),
              }
            }
            const choice = Array.isArray(chunk.choices) ? chunk.choices[0] : undefined
            if (!choice) continue
            if (choice.finish_reason) output.stopReason = mapStopReason(choice.finish_reason)

            if (choice.delta) {
              if (choice.delta.content && choice.delta.content.length > 0) {
                if (!currentBlock || currentBlock.type !== "text") {
                  currentBlock = { type: "text", text: "" }
                  blocks.push(currentBlock)
                  stream.push({ type: "text_start", contentIndex: blockIndex(), partial: output as any })
                }
                currentBlock.text += choice.delta.content
                stream.push({ type: "text_delta", contentIndex: blockIndex(), delta: choice.delta.content, partial: output as any })
              }
              const reasonFields = ["reasoning_content", "reasoning", "reasoning_text"]
              for (const f of reasonFields) {
                const val = (choice.delta as any)[f]
                if (val && String(val).length > 0) {
                  if (!currentBlock || currentBlock.type !== "thinking") {
                    currentBlock = { type: "thinking", thinking: "" }
                    blocks.push(currentBlock)
                    stream.push({ type: "thinking_start", contentIndex: blockIndex(), partial: output as any })
                  }
                  currentBlock.thinking += String(val)
                  stream.push({ type: "thinking_delta", contentIndex: blockIndex(), delta: String(val), partial: output as any })
                  break
                }
              }
              if (choice.delta.tool_calls) {
                for (const tc of choice.delta.tool_calls) {
                  if (!currentBlock || currentBlock.type !== "toolCall" || (tc.id && currentBlock.id !== tc.id)) {
                    currentBlock = { type: "toolCall", id: tc.id || "", name: tc.function?.name || "", arguments: {}, partialArgs: "" }
                    blocks.push(currentBlock)
                    stream.push({ type: "toolcall_start", contentIndex: blockIndex(), partial: output as any })
                  }
                  if (tc.id) currentBlock.id = tc.id
                  if (tc.function?.name) currentBlock.name = tc.function.name
                  if (tc.function?.arguments) {
                    currentBlock.partialArgs += tc.function.arguments
                    currentBlock.arguments = parseStreamingJson(currentBlock.partialArgs)
                  }
                  if (tc.function?.arguments) {
                    stream.push({ type: "toolcall_delta", contentIndex: blockIndex(), delta: tc.function.arguments, partial: output as any })
                  }
                }
              }
            }
          }

          if (currentBlock?.type === "toolCall") {
            currentBlock.arguments = parseStreamingJson(currentBlock.partialArgs || "")
            delete currentBlock.partialArgs
          }
          stream.push({ type: "done", reason: output.stopReason, message: output as any })
          stream.end()
        } catch (error) {
          output.stopReason = options?.signal?.aborted ? "aborted" : "error"
          output.errorMessage = error instanceof Error ? error.message : JSON.stringify(error)
          stream.push({ type: "error", reason: output.stopReason, error: output as any })
          stream.end()
        }
      }

      run()
      return stream
    },
  }

  registerProvider(provider)
  return provider
}

export function registerAllCustomProviders(configs: Record<string, CustomProviderConfig>): string[] {
  const registered: string[] = []
  for (const [id, cfg] of Object.entries(configs)) {
    if (cfg.enabled === false) continue
    registerCustomProvider(id, cfg)
    registered.push(id)
  }
  return registered
}
