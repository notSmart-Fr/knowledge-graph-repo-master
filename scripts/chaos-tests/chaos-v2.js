// @ts-nocheck
//
// Chaos Test Suite — Firewall v3
// Each section intentionally violates ONE rule. The firewall MUST flag every block.
// Run: bun scripts/ast-firewall.ts --chaos
import { z } from "zod";
// ═══════════════════════════════════════════════════════════════════════════
// RULE 1: Schema Constraints — unconstrained z.string() and z.number()
// Must have .max() on strings, .min()+ .max() on numbers in *Schema exports
// ═══════════════════════════════════════════════════════════════════════════
export const ViolationSchema1 = z.object({
    name: z.string(), // VIOLATION: no .max()
    age: z.number(), // VIOLATION: no .min() + .max()
    email: z.string().email(), // OK: .email() counts as constraint
});
// ═══════════════════════════════════════════════════════════════════════════
// RULE 2: Anti-Cheat — z.any().parse() / z.unknown().safeParse() forbidden
// ═══════════════════════════════════════════════════════════════════════════
export async function cheatBoundary(raw) {
    const x = z.any().parse(raw); // VIOLATION
    const y = z.unknown().safeParse(raw); // VIOLATION
    return { x, y };
}
// ═══════════════════════════════════════════════════════════════════════════
// RULE 3: Boundary Zod Wrap — fetch() must be inside Schema.parse()
// ═══════════════════════════════════════════════════════════════════════════
export async function rawFetch() {
    const data = await fetch("https://api.example.com"); // VIOLATION
    return data;
}
export async function safeFetch() {
    const raw = await fetch("https://api.example.com");
    return z.object({ id: z.number() }).parse(await raw.json()); // OK: wrapped
}
// ═══════════════════════════════════════════════════════════════════════════
// RULE 4: Catch Type-Guard — must be : unknown, no empty catch, guard .message
// ═══════════════════════════════════════════════════════════════════════════
export async function catchNaked() {
    try {
        await fetch("https://api.example.com");
    }
    catch (err) { // VIOLATION: not typed : unknown
        console.error(err.message); // VIOLATION: no instanceof guard
    }
}
export async function catchEmpty() {
    try {
        await fetch("https://api.example.com");
    }
    catch (error) { // OK: typed
        // VIOLATION: empty block
    }
}
export async function catchAsAny() {
    try {
        await fetch("https://api.example.com");
    }
    catch (error) {
        error.someProp; // VIOLATION: "as any" cast
    }
}
export async function catchValid() {
    try {
        await fetch("https://api.example.com");
    }
    catch (error) { // OK: typed
        if (error instanceof Error) { // OK: guarded
            console.error(error.message);
        }
    }
}
// ═══════════════════════════════════════════════════════════════════════════
// RULE 5: Data Error PII — no PII keys in error metadata or console.error
// ═══════════════════════════════════════════════════════════════════════════
class IntegrationError extends Error {
    constructor(code, message, meta) {
        super(message);
    }
}
export function piiInError() {
    const phone = "+1234567890";
    const email = "user@example.com";
    console.error(phone); // VIOLATION: PII identifier
    console.error(email); // VIOLATION: PII identifier
    throw new IntegrationError("ERR", "msg", {
        transcript: "raw text here", // VIOLATION: PII key
        password: "secret", // VIOLATION: PII key
    });
}
// ═══════════════════════════════════════════════════════════════════════════
// RULE 6: Graceful Shutdown — files with exit() must have SIG handlers
// ═══════════════════════════════════════════════════════════════════════════
export function abruptExit() {
    process.exit(1); // VIOLATION: exit() without SIG handlers
}
// ═══════════════════════════════════════════════════════════════════════════
// RULE 7: Neo4j Parameterized Queries — no string interp in session.run()
// ═══════════════════════════════════════════════════════════════════════════
export async function neo4jInterpolation(userInput) {
    // VIOLATION: string concatenation
    await session.run("MATCH (n:User {name: '" + userInput + "'}) RETURN n");
    // VIOLATION: template literal interpolation without param map
    await session.run(`MATCH (n:User {name: '${userInput}'}) RETURN n`);
    // VIOLATION: template literal, no params
    await tx.run(`MATCH (n:Product {slug: '${userInput}'}) RETURN n`);
    // OK: parameterized
    await session.run("MATCH (n:User {name: $name}) RETURN n", { name: userInput });
}
// ═══════════════════════════════════════════════════════════════════════════
// RULE 8: Supabase RLS Integrity — no raw SQL bypassing RLS in supabase files
// ═══════════════════════════════════════════════════════════════════════════
export async function supabaseRLSBypass() {
    // VIOLATION: raw SQL bypasses RLS
    await supabase.rpc("bypass_rls_get_all_users");
    // VIOLATION: raw SQL in supabase client file
    const result = await supabase.sql `SELECT * FROM users`;
    return result;
}
// ═══════════════════════════════════════════════════════════════════════════
// RULE 9: PG Vector Operator — embeddings queries must use native distance operators
// ═══════════════════════════════════════════════════════════════════════════
export async function vectorBruteForce() {
    const embedding = [0.1, 0.2, 0.3];
    await supabase.from("cache_embeddings").select("*"); // VIOLATION: no native distance operator
}
// ═══════════════════════════════════════════════════════════════════════════
// RULE 10: Output Sanitization — AI outputs must pass through sanitizer
// ═══════════════════════════════════════════════════════════════════════════
export async function aiWithoutSanitizer() {
    const result = await streamText({
        model: "gemini-2.5-flash",
        prompt: "Hello",
    });
    return result;
}
// ═══════════════════════════════════════════════════════════════════════════
// RULE 11: Mastra Tool Contract — id slug, description >= 20, inputSchema
// ═══════════════════════════════════════════════════════════════════════════
createTool({
    description: "short", // VIOLATION: < 20 chars
    // VIOLATION: missing inputSchema
});
createTool({
    id: "BAD_ID!!",
    description: "A proper tool description here", // OK: >= 20
    inputSchema: z.object({}), // OK
});
createTool({
    id: "search-catalog",
    description: "Search the product catalog by keyword or category filter",
    inputSchema: z.object({ query: z.string().max(200) }),
});
// ═══════════════════════════════════════════════════════════════════════════
// RULE 12: Agent Step Ceiling — maxSteps must exist and be <= 10
// ═══════════════════════════════════════════════════════════════════════════
new Agent({
    name: "ShopAgent",
    instructions: "Help customers",
});
new Agent({
    name: "ShopAgent",
    instructions: "Help customers",
    maxSteps: 50,
});
new Agent({
    name: "ShopAgent",
    instructions: "Help customers",
    maxSteps: 5,
});
// ═══════════════════════════════════════════════════════════════════════════
// RULE 13: Span PII Guard — no PII in setAttribute keys
// ═══════════════════════════════════════════════════════════════════════════
export async function leakySpan() {
    await tracer.startActiveSpan("process", async (span) => {
        span.setAttribute("phone", "+1234"); // VIOLATION: PII key
        span.setAttribute("transcript", "raw"); // VIOLATION: PII key
        span.setAttribute("message", "text"); // VIOLATION: PII key
        span.setAttribute("request_id", "abc"); // OK: not PII
        span.end();
    });
}
// ═══════════════════════════════════════════════════════════════════════════
// RULE 14: Span Coverage — core pipeline functions must have startActiveSpan
// ═══════════════════════════════════════════════════════════════════════════
// (Tested by making orchestrator.ts etc. exist without spans — see inline notes)
// This rule only activates for files in packages/ai-core/src/
// ═══════════════════════════════════════════════════════════════════════════
// RULE 15: No Any — explicit : any on vars, params, generics, return types
// ═══════════════════════════════════════════════════════════════════════════
const myVar = {}; // VIOLATION
function badParam(x) { return x; } // VIOLATION
const arr = []; // VIOLATION (generic)
function badReturn() { return {}; } // VIOLATION
// OK patterns:
const okVar = {};
function okParam(x) { return x; }
const okArr = [];
function okReturn() { return {}; }
// ═══════════════════════════════════════════════════════════════════════════
// PATCHED RULE5: Data Error PII — no PII in logger.* calls either!
// ═══════════════════════════════════════════════════════════════════════════
export function piiInLogger() {
    const phone = "+1234567890";
    const email = "user@example.com";
    // All of these are VIOLATIONS (we only checked console.error before)
    logger.info(phone);
    logger.warn(email);
    logger.debug("Transcript: " + phone);
}
// ═══════════════════════════════════════════════════════════════════════════
// PATCHED RULE13: Span PII Guard — no PII in span.addEvent() attributes either!
// ═══════════════════════════════════════════════════════════════════════════
export async function leakySpanEvents() {
    await tracer.startActiveSpan("process", async (span) => {
        span.addEvent("data_received", {
            phone: "+1234", // VIOLATION (new rule coverage)
            transcript: "raw", // VIOLATION (new rule coverage)
            message: "text", // VIOLATION (new rule coverage)
            request_id: "abc" // OK
        });
        span.end();
    });
}
// ═══════════════════════════════════════════════════════════════════════════
// PATCHED RULE15: No Any — no "as any" type assertions either!
// ═══════════════════════════════════════════════════════════════════════════
export function asAnyViolation(x) {
    const y = x; // VIOLATION (new rule coverage!)
    return y;
}
// ═══════════════════════════════════════════════════════════════════════════
// NEW RULE18: WebSocket Boundary — realtime .on() handlers must Zod.parse() payload
// ═══════════════════════════════════════════════════════════════════════════
export function realtimeNoZod() {
    // Supabase realtime subscription handler without Zod parsing payload
    const channel = supabase.channel("deals").on("INSERT", (payload) => {
        console.log(payload); // VIOLATION (Rule18): access payload without Zod.parse()
    });
}
export function realtimeSafe() {
    const channel = supabase.channel("deals").on("INSERT", (payload) => {
        // OK: Zod parses payload!
        const safePayload = z.object({ id: z.string(), title: z.string() }).parse(payload);
        console.log(safePayload);
    });
}
// ═══════════════════════════════════════════════════════════════════════════
// NEW RULE19: Crypto Algorithm — createCipheriv must use "aes-256-gcm"
// ═══════════════════════════════════════════════════════════════════════════
export function weakCrypto() {
    const key = Buffer.alloc(32);
    const iv = Buffer.alloc(12);
    createCipheriv("aes-128-cbc", key, iv); // VIOLATION (Rule19): weak algorithm
    createCipheriv("aes-256-cbc", key, iv); // VIOLATION (Rule19): use gcm mode
}
export function strongCrypto() {
    const key = Buffer.alloc(32);
    const iv = Buffer.alloc(12);
    createCipheriv("aes-256-gcm", key, iv); // OK
}
