// @ts-nocheck
//
// Chaos Test Suite — Firewall v2
// Each section intentionally violates ONE rule. The firewall MUST flag every block.
// Run: bun scripts/ast-firewall.ts --chaos

import { z } from "zod";

// ── Stubs to make chaos files compile-able ────────────────────────────────

declare const supabase: any;
declare const session: { run(q: string, p?: Record<string, unknown>): Promise<any> };
declare const tx: { run(q: string, p?: Record<string, unknown>): Promise<any> };
declare const tracer: { startActiveSpan(n: string, fn: (s: any) => any): any };
declare const Agent: any;
declare const createTool: any;
declare const streamText: any;
declare const generateText: any;
declare const fetch: any;

// ═══════════════════════════════════════════════════════════════════════════
// RULE 1: Schema Constraints — unconstrained z.string() and z.number()
// Must have .max() on strings, .min()+ .max() on numbers in *Schema exports
// ═══════════════════════════════════════════════════════════════════════════

export const ViolationSchema1 = z.object({
  name: z.string(),              // VIOLATION: no .max()
  age: z.number(),               // VIOLATION: no .min() + .max()
  email: z.string().email(),     // OK: .email() counts as constraint
});

// ═══════════════════════════════════════════════════════════════════════════
// RULE 2: Anti-Cheat — z.any().parse() / z.unknown().safeParse() forbidden
// ═══════════════════════════════════════════════════════════════════════════

export async function cheatBoundary(raw: unknown) {
  const x = z.any().parse(raw);           // VIOLATION
  const y = z.unknown().safeParse(raw);   // VIOLATION
  return { x, y };
}

// ═══════════════════════════════════════════════════════════════════════════
// RULE 3: Boundary Zod Wrap — fetch() must be inside Schema.parse()
// ═══════════════════════════════════════════════════════════════════════════

export async function rawFetch() {
  const data = await fetch("https://api.example.com");  // VIOLATION
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
  } catch (err) {                         // VIOLATION: not typed : unknown
    console.error(err.message);           // VIOLATION: no instanceof guard
  }
}

export async function catchEmpty() {
  try {
    await fetch("https://api.example.com");
  } catch (error: unknown) {              // OK: typed
    // VIOLATION: empty block
  }
}

export async function catchAsAny() {
  try {
    await fetch("https://api.example.com");
  } catch (error: unknown) {
    (error as any).someProp;              // VIOLATION: "as any" cast
  }
}

export async function catchValid() {
  try {
    await fetch("https://api.example.com");
  } catch (error: unknown) {              // OK: typed
    if (error instanceof Error) {         // OK: guarded
      console.error(error.message);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// RULE 5: Data Error PII — no PII keys in error metadata or console.error
// ═══════════════════════════════════════════════════════════════════════════

class IntegrationError extends Error {
  constructor(code: string, message: string, meta?: Record<string, unknown>) {
    super(message);
  }
}

export function piiInError() {
  const phone = "+1234567890";
  const email = "user@example.com";
  console.error(phone);                   // VIOLATION: PII identifier
  console.error(email);                   // VIOLATION: PII identifier

  throw new IntegrationError("ERR", "msg", {
    transcript: "raw text here",          // VIOLATION: PII key
    password: "secret",                   // VIOLATION: PII key
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// RULE 6: Graceful Shutdown — files with exit() must have SIG handlers
// ═══════════════════════════════════════════════════════════════════════════

export function abruptExit() {
  process.exit(1);                        // VIOLATION: exit() without SIG handlers
}

// ═══════════════════════════════════════════════════════════════════════════
// RULE 7: Neo4j Parameterized Queries — no string interp in session.run()
// ═══════════════════════════════════════════════════════════════════════════

export async function neo4jInterpolation(userInput: string) {
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
  const result = await supabase.sql`SELECT * FROM users`;
  return result;
}

// ═══════════════════════════════════════════════════════════════════════════
// RULE 9: PG Vector Operator — embeddings queries must use native distance operators
// ═══════════════════════════════════════════════════════════════════════════

export async function vectorBruteForce() {
  const embedding = [0.1, 0.2, 0.3];
  await supabase.from("cache_embeddings").select("*");  // VIOLATION: no native distance operator
}

// ═══════════════════════════════════════════════════════════════════════════
// RULE 10: Output Sanitization — AI outputs must pass through sanitizer
// ═══════════════════════════════════════════════════════════════════════════

export async function aiWithoutSanitizer() {
  const result = await streamText({          // VIOLATION: no output sanitizer in this file
    model: "gemini-2.5-flash",
    prompt: "Hello",
  });
  return result;
}

// ═══════════════════════════════════════════════════════════════════════════
// RULE 11: Mastra Tool Contract — id slug, description >= 20, inputSchema
// ═══════════════════════════════════════════════════════════════════════════

createTool({                                  // VIOLATION: missing id
  description: "short",                       // VIOLATION: < 20 chars
  // VIOLATION: missing inputSchema
});

createTool({                                  // VIOLATION: bad id
  id: "BAD_ID!!",
  description: "A proper tool description here", // OK: >= 20
  inputSchema: z.object({}),                   // OK
});

createTool({                                   // OK: valid contract
  id: "search-catalog",
  description: "Search the product catalog by keyword or category filter",
  inputSchema: z.object({ query: z.string().max(200) }),
});

// ═══════════════════════════════════════════════════════════════════════════
// RULE 12: Agent Step Ceiling — maxSteps must exist and be <= 10
// ═══════════════════════════════════════════════════════════════════════════

new Agent({                                    // VIOLATION: no maxSteps
  name: "ShopAgent",
  instructions: "Help customers",
});

new Agent({                                    // VIOLATION: maxSteps too high
  name: "ShopAgent",
  instructions: "Help customers",
  maxSteps: 50,
});

new Agent({                                    // OK
  name: "ShopAgent",
  instructions: "Help customers",
  maxSteps: 5,
});

// ═══════════════════════════════════════════════════════════════════════════
// RULE 13: Span PII Guard — no PII in setAttribute keys
// ═══════════════════════════════════════════════════════════════════════════

export async function leakySpan() {
  await tracer.startActiveSpan("process", async (span: any) => {
    span.setAttribute("phone", "+1234");       // VIOLATION: PII key
    span.setAttribute("transcript", "raw");    // VIOLATION: PII key
    span.setAttribute("message", "text");      // VIOLATION: PII key
    span.setAttribute("request_id", "abc");    // OK: not PII
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

const myVar: any = {};                        // VIOLATION
function badParam(x: any) { return x; }       // VIOLATION
const arr: Array<any> = [];                   // VIOLATION (generic)
function badReturn(): any { return {}; }      // VIOLATION

// OK patterns:
const okVar: unknown = {};
function okParam(x: unknown) { return x; }
const okArr: Array<unknown> = [];
function okReturn(): unknown { return {}; }
