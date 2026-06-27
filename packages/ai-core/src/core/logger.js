const piiPatterns = [
    "phone", "email", "sender", "text", "message",
    "transcript", "password", "token", "secret",
    "api_key", "access_key", "private_key"
];
function sanitizeMeta(meta) {
    if (!meta)
        return {};
    const safe = {};
    for (const [key, value] of Object.entries(meta)) {
        const lowerKey = key.toLowerCase();
        if (!piiPatterns.some(p => lowerKey.includes(p))) {
            safe[key] = value;
        }
    }
    return safe;
}
export function createLogger(module) {
    const log = (level, message, meta) => {
        const entry = {
            timestamp: new Date().toISOString(),
            level,
            module,
            message,
            meta: sanitizeMeta(meta),
        };
        console.log(JSON.stringify(entry));
    };
    return {
        info: (message, meta) => log("info", message, meta),
        warn: (message, meta) => log("warn", message, meta),
        error: (message, meta) => log("error", message, meta),
        debug: (message, meta) => log("debug", message, meta),
    };
}
