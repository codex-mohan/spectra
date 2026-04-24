import React, { useState, useCallback, useRef, useEffect } from "react";
import {
  render,
  useInput,
  useApp,
  Box,
  Text,
  useStdout,
} from "ink";
import TextInput from "ink-text-input";
import { Agent } from "@spectra/agent";
import type { AssistantMessage, TextContent, ThinkingContent, ToolCall } from "@spectra/ai";
import "dotenv/config";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const MODEL = {
  id: process.env.OPENROUTER_MODEL || "anthropic/claude-3.5-sonnet",
  name: process.env.OPENROUTER_MODEL || "anthropic/claude-3.5-sonnet",
  provider: "openrouter" as const,
  api: "openai-completions" as const,
};

const SYSTEM_PROMPT =
  process.env.OPENROUTER_SYSTEM_PROMPT || "You are a helpful assistant.";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateId(): string {
  return Math.random().toString(36).slice(2, 9);
}

type ContentBlock =
  | { type: "text"; content: string }
  | { type: "thinking"; content: string }
  | { type: "toolCall"; name: string; args: string };

function getMessageBlocks(msg: AssistantMessage): ContentBlock[] {
  const blocks: ContentBlock[] = [];

  for (const c of msg.content) {
    if (c.type === "text") {
      blocks.push({ type: "text", content: (c as TextContent).text });
    } else if (c.type === "thinking") {
      blocks.push({ type: "thinking", content: (c as ThinkingContent).thinking });
    } else if (c.type === "toolCall") {
      const tc = c as ToolCall;
      blocks.push({
        type: "toolCall",
        name: tc.name,
        args: JSON.stringify(tc.arguments, null, 2),
      });
    }
  }

  if (msg.errorMessage) {
    blocks.push({ type: "text", content: `[error] ${msg.errorMessage}` });
  }

  return blocks;
}

const SPINNER = ["\u280b", "\u2819", "\u2839", "\u2838", "\u283c", "\u2834", "\u2826", "\u2827", "\u2807", "\u280f"];

interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "tool" | "error";
  content: string;
  blocks?: ContentBlock[];
  meta?: string;
  streaming?: boolean;
}

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

const ThinkingBlock: React.FC<{ content: string }> = ({ content }) => (
  <Box flexDirection="column" marginY={1}>
    <Text bold color="gray">
      {"\u250c"}{"\u2500"}{"\u2500"} Thinking {"\u2500"}{"\u2500"}{"\u2510"}
    </Text>
    <Box marginLeft={2}>
      <Text dimColor wrap="wrap">
        {content || "(thinking...)"}
      </Text>
    </Box>
    <Text bold color="gray">
      {"\u2514"}{"\u2500"}{"\u2500"}{"\u2500"}{"\u2500"}{"\u2500"}{"\u2500"}{"\u2500"}{"\u2500"}{"\u2500"}{"\u2518"}
    </Text>
  </Box>
);

const ToolCallBlock: React.FC<{ name: string; args: string }> = ({ name, args }) => (
  <Box flexDirection="column" marginY={1}>
    <Text bold color="yellow">
      {"\u250c"}{"\u2500"}{"\u2500"} Tool Call: {name} {"\u2500"}{"\u2500"}{"\u2510"}
    </Text>
    <Box marginLeft={2}>
      <Text dimColor wrap="wrap">
        {args}
      </Text>
    </Box>
    <Text bold color="yellow">
      {"\u2514"}{"\u2500"}{"\u2500"}{"\u2500"}{"\u2500"}{"\u2500"}{"\u2500"}{"\u2500"}{"\u2500"}{"\u2500"}{"\u2518"}
    </Text>
  </Box>
);

const App: React.FC = () => {
  const { exit } = useApp();
  const { stdout } = useStdout();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [status, setStatus] = useState("Ready");
  const [spinnerFrame, setSpinnerFrame] = useState(0);
  const [termSize, setTermSize] = useState({
    rows: stdout.rows,
    cols: stdout.columns,
  });
  const [showDebug, setShowDebug] = useState(false);
  const [debugLines, setDebugLines] = useState<string[]>([]);
  const [tps, setTps] = useState<number | null>(null);
  const [elapsedMs, setElapsedMs] = useState<number | null>(null);

  const agentRef = useRef(
    new Agent({
      model: MODEL,
      systemPrompt: SYSTEM_PROMPT,
      maxTurns: 10,
    })
  );
  const streamingIdRef = useRef<string | null>(null);
  const assistantStartTimeRef = useRef<number | null>(null);
  const assistantChunkCountRef = useRef(0);

  // Debug logger
  const pushDebug = useCallback((line: string) => {
    setDebugLines((prev) => {
      const next = [...prev, line];
      if (next.length > 40) next.shift();
      return next;
    });
  }, []);

  // Terminal resize
  useEffect(() => {
    const onResize = () =>
      setTermSize({ rows: stdout.rows, cols: stdout.columns });
    stdout.on("resize", onResize);
    return () => { stdout.off("resize", onResize); };
  }, [stdout]);

  // Spinner animation
  useEffect(() => {
    if (!isLoading) return;
    const id = setInterval(() => {
      setSpinnerFrame((f) => (f + 1) % SPINNER.length);
    }, 80);
    return () => clearInterval(id);
  }, [isLoading]);

  // Global shortcuts
  useInput((input, key) => {
    if (key.escape) {
      agentRef.current.abort();
      exit();
    }
    if (key.ctrl && input === "l") {
      setMessages([]);
      setStatus("Cleared");
    }
    if (key.ctrl && input === "d") {
      setShowDebug((s) => !s);
    }
  });

  const addMessage = useCallback((msg: ChatMessage) => {
    setMessages((prev) => [...prev, msg]);
  }, []);

  const updateMessage = useCallback(
    (id: string, updates: Partial<ChatMessage>) => {
      setMessages((prev) =>
        prev.map((m) => (m.id === id ? { ...m, ...updates } : m))
      );
    },
    []
  );

  const handleSubmit = useCallback(
    async (value: string) => {
      const trimmed = value.trim();
      if (!trimmed || isLoading) return;

      // Reset metrics
      setTps(null);
      setElapsedMs(null);
      assistantStartTimeRef.current = null;
      assistantChunkCountRef.current = 0;

      // User message
      addMessage({ id: generateId(), role: "user", content: trimmed });
      setInput("");
      setIsLoading(true);
      setStatus("Streaming...");

      // Assistant placeholder
      const assistantId = generateId();
      streamingIdRef.current = assistantId;
      addMessage({
        id: assistantId,
        role: "assistant",
        content: "",
        blocks: [],
        streaming: true,
      });

      const agent = agentRef.current;

      try {
        for await (const event of agent.run(trimmed)) {
          // Log every event to debug
          const raw = JSON.stringify(event).slice(0, 300);
          pushDebug(`[EVT:${event.type}] ${raw}`);

          switch (event.type) {
            case "agent_start": {
              pushDebug("[AGENT] agent_start");
              break;
            }
            case "turn_start": {
              pushDebug("[AGENT] turn_start");
              break;
            }
            case "message_start": {
              if (event.message.role === "assistant") {
                assistantStartTimeRef.current = Date.now();
                assistantChunkCountRef.current = 0;
                pushDebug(
                  `[MSG_START] content.length=${event.message.content.length} usage=${JSON.stringify(
                    event.message.usage
                  )}`
                );
              }
              break;
            }
            case "message_update": {
              if (
                event.message.role === "assistant" &&
                streamingIdRef.current
              ) {
                const blocks = getMessageBlocks(event.message);
                const text = blocks
                  .filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")
                  .map((b) => b.content)
                  .join("\n");
                updateMessage(streamingIdRef.current, {
                  content: text,
                  blocks,
                });

                // Track chunks for TPS fallback
                if (event.assistantMessageEvent.type === "text_delta") {
                  assistantChunkCountRef.current += 1;
                  pushDebug(
                    `[TXT_DELTA] idx=${event.assistantMessageEvent.contentIndex} delta="${event.assistantMessageEvent.delta}"`
                  );
                }
                if (event.assistantMessageEvent.type === "thinking_delta") {
                  assistantChunkCountRef.current += 1;
                  pushDebug(
                    `[THK_DELTA] idx=${event.assistantMessageEvent.contentIndex} delta="${event.assistantMessageEvent.delta}"`
                  );
                }
                if (event.assistantMessageEvent.type === "toolcall_delta") {
                  assistantChunkCountRef.current += 1;
                  pushDebug(
                    `[TOOL_DELTA] idx=${event.assistantMessageEvent.contentIndex} delta="${event.assistantMessageEvent.delta}"`
                  );
                }
              }
              break;
            }
            case "message_end": {
              if (
                event.message.role === "assistant" &&
                streamingIdRef.current
              ) {
                const blocks = getMessageBlocks(event.message);
                const text = blocks
                  .filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")
                  .map((b) => b.content)
                  .join("\n");
                updateMessage(streamingIdRef.current, {
                  content: text,
                  blocks,
                  streaming: false,
                });

                // Compute TPS
                const start = assistantStartTimeRef.current ?? Date.now();
                const elapsed = Date.now() - start;
                setElapsedMs(elapsed);

                const outputTokens = event.message.usage.output;
                if (outputTokens > 0 && elapsed > 0) {
                  const tokensPerSec = outputTokens / (elapsed / 1000);
                  setTps(tokensPerSec);
                  pushDebug(
                    `[METRICS] outputTokens=${outputTokens} elapsed=${elapsed}ms tps=${tokensPerSec.toFixed(2)}`
                  );
                } else if (elapsed > 0) {
                  const chunkPerSec = assistantChunkCountRef.current / (elapsed / 1000);
                  setTps(chunkPerSec); // fallback: chunks/sec
                  pushDebug(
                    `[METRICS] chunks=${assistantChunkCountRef.current} elapsed=${elapsed}ms chunks/sec=${chunkPerSec.toFixed(2)} (fallback)`
                  );
                }

                streamingIdRef.current = null;
              }
              break;
            }
            case "tool_execution_start": {
              setStatus(`Tool: ${event.toolName}`);
              addMessage({
                id: generateId(),
                role: "tool",
                content: "",
                meta: `${event.toolName}(${JSON.stringify(event.args)})`,
              });
              break;
            }
            case "tool_execution_end": {
              pushDebug(
                `[TOOL_END] ${event.toolName} isError=${event.isError} result=${JSON.stringify(
                  event.result
                ).slice(0, 200)}`
              );
              setStatus("Streaming...");
              break;
            }
            case "turn_end": {
              pushDebug(
                `[TURN_END] stopReason=${event.message.stopReason} toolResults=${event.toolResults.length}`
              );
              break;
            }
            case "agent_end": {
              setStatus("Ready");
              pushDebug("[AGENT] agent_end");
              break;
            }
          }
        }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        pushDebug(`[CATCH] ${errorMsg}`);
        if (streamingIdRef.current) {
          updateMessage(streamingIdRef.current, {
            content: `Error: ${errorMsg}`,
            streaming: false,
            role: "error",
          });
          streamingIdRef.current = null;
        } else {
          addMessage({ id: generateId(), role: "error", content: errorMsg });
        }
        setStatus("Error");
      } finally {
        setIsLoading(false);
        streamingIdRef.current = null;
      }
    },
    [isLoading, addMessage, updateMessage, pushDebug]
  );

  const statusColor =
    status === "Error" ? "red" : status === "Ready" ? "green" : "yellow";

  const chatHeight = showDebug
    ? Math.floor(termSize.rows * 0.55)
    : termSize.rows;

  return (
    <Box flexDirection="column" height={termSize.rows}>
      {/* Header */}
      <Box
        borderStyle="single"
        paddingX={1}
        flexDirection="row"
        justifyContent="space-between"
      >
        <Box flexDirection="row" gap={1}>
          <Text bold color="cyan">
            Spectra Chat TUI
          </Text>
          {tps !== null && (
            <Text color="magenta">
              {tps.toFixed(1)} {elapsedMs && elapsedMs > 0 ? "tok/s" : "chunks/s"}
            </Text>
          )}
        </Box>
        <Box flexDirection="row">
          <Text dimColor>{MODEL.id}</Text>
          <Text dimColor> {"|"} </Text>
          <Text color={statusColor}>{status}</Text>
          <Text dimColor> {"|"} Ctrl+D debug</Text>
        </Box>
      </Box>

      {/* Messages */}
      <Box
        flexDirection="column"
        height={chatHeight - 3}
        paddingX={1}
        paddingY={1}
      >
        {messages.length === 0 && (
          <Box
            flexDirection="column"
            alignItems="center"
            justifyContent="center"
            flexGrow={1}
          >
            <Text dimColor>Welcome to Spectra Chat</Text>
            <Text dimColor>Type a message and press Enter</Text>
            <Text dimColor>Esc to quit {"*"} Ctrl+L to clear {"*"} Ctrl+D debug</Text>
          </Box>
        )}

        {messages.map((msg) => (
          <Box key={msg.id} flexDirection="column" marginBottom={1}>
            {/* Role label */}
            {msg.role === "user" && (
              <Box justifyContent="flex-end" marginBottom={1}>
                <Text bold color="blue">
                  You
                </Text>
              </Box>
            )}
            {msg.role === "assistant" && (
              <Box marginBottom={1}>
                <Text bold color="green">
                  Assistant
                </Text>
                {msg.streaming && (
                  <Text color="yellow"> {SPINNER[spinnerFrame]}</Text>
                )}
                {msg.content === "" && msg.streaming && (
                  <Text dimColor> (waiting for first token...)</Text>
                )}
              </Box>
            )}
            {msg.role === "tool" && (
              <Box marginBottom={1}>
                <Text bold color="yellow">
                  {">"} {msg.meta}
                </Text>
              </Box>
            )}
            {msg.role === "error" && (
              <Box marginBottom={1}>
                <Text bold color="red">
                  Error
                </Text>
              </Box>
            )}

            {/* Structured content for assistant messages */}
            {msg.role === "assistant" && msg.blocks ? (
              <Box
                flexDirection="column"
                marginLeft={0}
                marginRight={4}
              >
                {msg.blocks.length === 0 && msg.streaming && (
                  <Text dimColor>(waiting for first token...)</Text>
                )}
                {msg.blocks.map((block, idx) => {
                  if (block.type === "thinking") {
                    return <ThinkingBlock key={idx} content={block.content} />;
                  }
                  if (block.type === "toolCall") {
                    return (
                      <ToolCallBlock
                        key={idx}
                        name={block.name}
                        args={block.args}
                      />
                    );
                  }
                  // text
                  return (
                    <Box key={idx} marginY={1}>
                      <Text wrap="wrap">{block.content}</Text>
                    </Box>
                  );
                })}
              </Box>
            ) : (
              /* Plain content for non-assistant messages */
              <Box
                marginLeft={msg.role === "user" ? 4 : 0}
                marginRight={msg.role === "user" ? 0 : 4}
              >
                <Text wrap="wrap">{msg.content || " "}</Text>
              </Box>
            )}
          </Box>
        ))}
      </Box>

      {/* Debug Panel */}
      {showDebug && (
        <Box
          borderStyle="single"
          paddingX={1}
          flexDirection="column"
          flexGrow={1}
        >
          <Text bold dimColor>
            Debug Log ({debugLines.length} lines)
          </Text>
          <Box flexDirection="column" flexGrow={1}>
            {debugLines.length === 0 && (
              <Text dimColor>No events yet...</Text>
            )}
            {debugLines.map((line, i) => (
              <Text key={i} dimColor wrap="truncate-end">
                {line}
              </Text>
            ))}
          </Box>
        </Box>
      )}

      {/* Input */}
      <Box borderStyle="single" paddingX={1} flexDirection="row">
        {isLoading ? (
          <Text color="cyan">
            {SPINNER[spinnerFrame]} Thinking...
          </Text>
        ) : (
          <>
            <Text bold color="cyan">
              {">"}
            </Text>
            <Box marginLeft={1} flexGrow={1}>
              <TextInput
                value={input}
                onChange={setInput}
                onSubmit={handleSubmit}
                placeholder="Type a message..."
                focus={!isLoading}
              />
            </Box>
          </>
        )}
      </Box>
    </Box>
  );
};

render(<App />);
