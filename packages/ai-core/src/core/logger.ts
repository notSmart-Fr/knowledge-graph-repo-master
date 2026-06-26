interface LogEntry {
  timestamp: string;
  level: "info" | "warn" | "error" | "debug";
  module: string;
  traceId?: string;
  spanId?: string;
  message: string;
  meta?: Record<string, unknown>;
}

const piiPatterns = [
  "phone", "email", "sender", "text", "message", 
  "transcript", "password", "token", "secret", 
  "api_key", "access_key", "private_key"
];

function sanitizeMeta(meta?: Record<string, unknown>): Record<string, unknown> {
  if (!meta) return {};
  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(meta)) {
    const lowerKey = key.toLowerCase();
    if (!piiPatterns.some(p => lowerKey.includes(p))) {
      safe[key] = value;
    }
  }
  return safe;
}

export function createLogger(module: string) {
  const log = (level: LogEntry["level"], message: string, meta?: Record<string, unknown>) => {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      module,
      message,
      meta: sanitizeMeta(meta),
    };
    console.log(JSON.stringify(entry));
  };

  return {
    info: (message: string, meta?: Record<string, unknown>) => log("info", message, meta),
    warn: (message: string, meta?: Record<string, unknown>) => log("warn", message, meta),
    error: (message: string, meta?: Record<string, unknown>) => log("error", message, meta),
    debug: (message: string, meta?: Record<string, unknown>) => log("debug", message, meta),
  };
}
