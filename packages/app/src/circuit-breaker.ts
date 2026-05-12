import type { CircuitBreaker, CircuitBreakerConfig, CircuitBreakerState } from "./types.js";

export class DefaultCircuitBreaker implements CircuitBreaker {
  private _state: CircuitBreakerState = "CLOSED";
  private _failureCount = 0;
  private lastFailureTime = 0;
  private halfOpenCount = 0;
  private config: CircuitBreakerConfig;

  constructor(config?: Partial<CircuitBreakerConfig>) {
    this.config = {
      failureThreshold: config?.failureThreshold ?? 5,
      resetTimeoutMs: config?.resetTimeoutMs ?? 30000,
      halfOpenMaxRequests: config?.halfOpenMaxRequests ?? 3,
    };
  }

  get state(): CircuitBreakerState {
    this.transitionIfNeeded();
    return this._state;
  }

  get failureCount(): number {
    return this._failureCount;
  }

  async call<T>(fn: () => Promise<T>): Promise<T> {
    this.transitionIfNeeded();

    if (this._state === "OPEN") {
      throw new CircuitBreakerOpenError(
        `Circuit breaker is OPEN. Last failure: ${new Date(this.lastFailureTime).toISOString()}`
      );
    }

    if (this._state === "HALF_OPEN" && this.halfOpenCount >= this.config.halfOpenMaxRequests) {
      throw new CircuitBreakerOpenError(
        `Circuit breaker HALF_OPEN limit reached (${this.config.halfOpenMaxRequests} max probe requests)`
      );
    }

    try {
      if (this._state === "HALF_OPEN") {
        this.halfOpenCount++;
      }
      const result = await fn();
      this.recordSuccess();
      return result;
    } catch (err) {
      this.recordFailure();
      throw err;
    }
  }

  recordSuccess(): void {
    this._failureCount = 0;
    this.halfOpenCount = 0;
    this._state = "CLOSED";
  }

  recordFailure(): void {
    this._failureCount++;
    this.lastFailureTime = Date.now();

    if (this._state === "CLOSED" && this._failureCount >= this.config.failureThreshold) {
      this._state = "OPEN";
    } else if (this._state === "HALF_OPEN") {
      this._state = "OPEN";
      this.halfOpenCount = 0;
    }
  }

  private transitionIfNeeded(): void {
    if (
      this._state === "OPEN" &&
      Date.now() - this.lastFailureTime >= this.config.resetTimeoutMs
    ) {
      this._state = "HALF_OPEN";
      this.halfOpenCount = 0;
    }
  }
}

export class CircuitBreakerOpenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CircuitBreakerOpenError";
  }
}
