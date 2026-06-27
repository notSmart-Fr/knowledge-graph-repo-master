const ProfanityFilter = /\b(fuck|shit|asshole|bitch|cunt|damn)\b/gi;
const PIIPatterns = [
    /\+?1?\d{1,3}[-.\s]?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g, // phone numbers
    /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, // emails
];
function stripProfanity(text) {
    return text.replace(ProfanityFilter, "****");
}
function stripPII(text) {
    let result = text;
    for (const pattern of PIIPatterns) {
        result = result.replace(pattern, "[REDACTED]");
    }
    return result;
}
function stripPromptInjection(text) {
    // Simple heuristic to remove prompt injection patterns
    return text.replace(/(ignore|disregard|bypass|skip|override|act as|pretend to be|forget).*?previous instructions/gi, "")
        .replace(/(system|user|assistant|human|ai|chatbot):/gi, "");
}
export function validateAndFilterOutput(raw) {
    // First parse to ensure it's a string
    const rawText = typeof raw === "string" ? raw : String(raw);
    let sanitized = stripProfanity(rawText);
    sanitized = stripPII(sanitized);
    sanitized = stripPromptInjection(sanitized);
    return sanitized.trim();
}
export function validateAndFilterResponse(response) {
    return {
        ...response,
        text: validateAndFilterOutput(response.text),
    };
}
