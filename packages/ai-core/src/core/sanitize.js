const ProfanityFilter = /\b(fuck|shit|asshole|bitch|cunt|damn)\b/gi;
// PII patterns: phone numbers and emails
// ponytail: the original regex required 4 digit groups (int'l format) and
// only matched 11+ digit numbers, so "555-123-4567" (10 digits) was missed.
// Allow 0-3 digit country-code prefix so US and international formats both match.
const PIIPatterns = [
    /\+?\d{0,3}[-.\s]?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g,
    /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
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
    // ponytail: heuristic-only; cover the obvious injection templates without
    // trying to be exhaustive. Add new patterns here as they appear in the wild.
    return text
        .replace(/(ignore|disregard|bypass|skip|override|act as|pretend to be|forget).*?previous instructions/gi, "")
        .replace(/(system|user|assistant|human|ai|chatbot):/gi, "");
}
export function validateAndFilterOutput(raw) {
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
