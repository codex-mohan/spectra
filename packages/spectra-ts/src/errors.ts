export class SpectraError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly detail?: unknown
  ) {
    super(message);
    this.name = "SpectraError";
  }
}

export class ProviderError extends SpectraError {
  constructor(provider: string, message: string, detail?: unknown) {
    super("spectra::llm::provider", `LLM provider error: ${provider} — ${message}`, detail);
  }
}

export class ToolError extends SpectraError {
  constructor(name: string, reason: string, detail?: unknown) {
    super("spectra::tool::exec", `Tool execution failed: '${name}' — ${reason}`, detail);
  }
}

export class StreamError extends SpectraError {
  constructor(reason: string) {
    super("spectra::stream::interrupted", `Stream interrupted: ${reason}`);
  }
}

export class SchemaError extends SpectraError {
  constructor(name: string, detail: string) {
    super("spectra::tool::schema", `Schema validation failed for tool '${name}': ${detail}`);
  }
}
