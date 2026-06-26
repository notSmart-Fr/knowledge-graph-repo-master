import { z } from "zod";
import { OrchestratorResponseSchema } from "./ports.js";

const ProfanityFilter = /\b(fuck|shit|asshole|bitch|cunt|damn)\b/gi;

const PIIPatterns = [
  /\+?1?\d{1,3}[-.\s]?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g, // phone numbers
  /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, // emails
];

function stripProfanity(text: string): string {
  return text.replace(ProfanityFilter, "****");
}

function stripPII(text: string): string {
  let result = text;
  for (const pattern of PIIPatterns) {
    result = result.replace(pattern, "[REDACTED]");
  }
  return result;
}

function stripPromptInjection(text: string): string {
  // Simple heuristic to remove prompt injection patterns
  return text.replace(/(ignore|disregard|bypass|skip|override|act as|pretend to be|forget).*?previous instructions/gi, "")
             .replace(/(system|user|assistant|human|ai|chatbot):/gi, "");
}

export function validateAndFilterOutput(raw: unknown): string {
  // First parse to ensure it's a string
  const rawText = typeof raw === "string" ? raw : String(raw);
  let sanitized = stripProfanity(rawText);
  sanitized = stripPII(sanitized);
  sanitized = stripPromptInjection(sanitized);
  return sanitized.trim();
}

export function validateAndFilterResponse(response: z.infer<typeof OrchestratorResponseSchema>): z.infer<typeof OrchestratorResponseSchema> {
  return {
    ...response,
    text: validateAndFilterOutput(response.text),
  };
}
