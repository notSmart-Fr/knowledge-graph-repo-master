export class IntegrationError extends Error {
  readonly code: string;
  readonly meta: Record<string, unknown>;

  constructor(code: string, message: string, meta?: Record<string, unknown>) {
    super(message);
    this.name = "IntegrationError";
    this.code = code;
    this.meta = meta || {};
    // Ensure no PII in meta by construction
    const safeMeta: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(this.meta)) {
      const lowerKey = key.toLowerCase();
      if (!["phone", "email", "sender", "text", "message", "transcript", "password", "token", "secret", "api_key", "access_key", "private_key"].includes(lowerKey)) {
        safeMeta[key] = value;
      }
    }
    this.meta = safeMeta;
  }
}

export class DatabaseDomainError extends Error {
  readonly code: string;
  readonly meta: Record<string, unknown>;

  constructor(code: string, message: string, meta?: Record<string, unknown>) {
    super(message);
    this.name = "DatabaseDomainError";
    this.code = code;
    this.meta = meta || {};
  }
}

export class GraphTraversalError extends IntegrationError {
  constructor(message: string, meta?: Record<string, unknown>) {
    super("GRAPH_TRAVERSAL_FAILED", message, meta);
    this.name = "GraphTraversalError";
  }
}

export class CacheError extends IntegrationError {
  constructor(code: string, message: string, meta?: Record<string, unknown>) {
    super(code, message, meta);
    this.name = "CacheError";
  }
}

export class CircuitBreakerOpenError extends Error {
  readonly name: string;
  readonly adapter: string;

  constructor(adapter: string) {
    super(`Circuit breaker is open for adapter: ${adapter}`);
    this.name = "CircuitBreakerOpenError";
    this.adapter = adapter;
  }
}
