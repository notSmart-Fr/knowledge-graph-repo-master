export class IntegrationError extends Error {
    code;
    meta;
    constructor(code, message, meta) {
        super(message);
        this.name = "IntegrationError";
        this.code = code;
        this.meta = meta || {};
        // Ensure no PII in meta by construction
        const safeMeta = {};
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
    code;
    meta;
    constructor(code, message, meta) {
        super(message);
        this.name = "DatabaseDomainError";
        this.code = code;
        this.meta = meta || {};
    }
}
export class GraphTraversalError extends IntegrationError {
    constructor(message, meta) {
        super("GRAPH_TRAVERSAL_FAILED", message, meta);
        this.name = "GraphTraversalError";
    }
}
export class CacheError extends IntegrationError {
    constructor(code, message, meta) {
        super(code, message, meta);
        this.name = "CacheError";
    }
}
export class CircuitBreakerOpenError extends Error {
    name;
    adapter;
    constructor(adapter) {
        super(`Circuit breaker is open for adapter: ${adapter}`);
        this.name = "CircuitBreakerOpenError";
        this.adapter = adapter;
    }
}
