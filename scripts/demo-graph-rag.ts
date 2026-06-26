/**
 * demo-graph-rag.ts — Before/after comparison: Vector RAG vs Graph RAG
 *
 * Usage:
 *   node --no-warnings --experimental-strip-types scripts/demo-graph-rag.ts
 *
 * Requires: Postgres + env files configured.
 */

import { sdk } from './otel-bootstrap.ts';
import { loadMonorepoEnv } from "./load-env.ts";
loadMonorepoEnv();

import { trace, type Span } from "@opentelemetry/api";
import { DataSource } from "typeorm";
import { Kysely, PostgresDialect, sql } from "kysely";

const tracer = trace.getTracer("demo-graph-rag");

// ── Replicate orchestrator DB connection ────────────────────────────────

const dataSource = new DataSource({
  type: "postgres",
  host: process.env.DB_HOST || "localhost",
  port: parseInt(process.env.DB_PORT || "5432"),
  username: process.env.DB_USER || "postgres",
  password: process.env.DB_PASSWORD || "postgres",
  database: process.env.DB_NAME || "vendure",
  ssl: process.env.DB_HOST && process.env.DB_HOST !== "localhost"
    ? { rejectUnauthorized: false }
    : false,
  synchronize: false,
  logging: false,
});

interface MatchedProduct {
  id: number;
  name: string;
  slug: string;
  description: string;
}

interface MatchedVariant {
  id: number;
  productId: number;
  price: number;
  sku: string;
  enabled: boolean;
}

async function main() {
  await dataSource.initialize();
  const rawPool = (dataSource.driver as unknown as { master: unknown }).master;

  // Kysely for vector queries
  const db = new Kysely<{
    product: {
      id: number;
      deletedAt: Date | null;
      customFieldsEmbedding: string | null;
    };
    product_translation: {
      id: number;
      baseId: number;
      name: string;
      slug: string;
      description: string;
    };
  }>({
          // @ts-ignore -- valid pg Pool at runtime
      dialect: new PostgresDialect({ pool: rawPool }),
  });

  // Dynamic imports (cross-package for embedding + graph retriever)
  const { getEmbedding } = await import("@dtc/ai-core/cache-engine");
  const { expandProductGraph, formatGraphContext } = await import(
    "@dtc/ai-core/graph-retriever"
  );

  const queries = [
    "Show me wool coats for winter",
    "I need an outfit for a dinner event",
    "What accessories go with a black blazer?",
  ];

  for (const query of queries) {
    console.log(`\n${"=".repeat(60)}`);
    console.log(`QUERY: "${query}"`);
    console.log("=".repeat(60));

    // ── Step 1: Vector RAG (existing pipeline) ─────────────────────────

    const embedding = await getEmbedding(query);
    const vectorLiteral = `[${embedding.join(",")}]`;

    const vectorResults = (await db
      .selectFrom("product as p")
      .innerJoin("product_translation as pt", "pt.baseId", "p.id")
      .select(["p.id", "pt.name", "pt.slug", "pt.description"])
      .where("p.deletedAt", "is", null)
      .orderBy(
        sql`p."customFieldsEmbedding" <=> cast(${vectorLiteral} as vector)`,
        "asc"
      )
      .limit(3)
      .execute()) as unknown as MatchedProduct[];

    console.log("\n─── Vector RAG (top-3 by cosine) ───");
    for (const p of vectorResults) {
      console.log(`  • ${p.name} (${p.slug})`);

      // @ts-ignore -- rawPool.query valid at runtime
      const variantRows = await rawPool.query(
        `SELECT sku, price, enabled FROM product_variant WHERE "productId" = $1 AND "deletedAt" IS NULL LIMIT 3`,
        [p.id]
      );
      for (const v of variantRows.rows as unknown as MatchedVariant[]) {
        console.log(`      SKU: ${v.sku} | $${(v.price / 100).toFixed(2)} | ${v.enabled ? "In stock" : "OOS"}`);
      }
    }

    // ── Step 2: Graph RAG (vector seeds + graph expansion) ─────────────

    await tracer.startActiveSpan("graph-rag-demo", async (span: Span) => {
      span.setAttribute("query", query);

      await tracer.startActiveSpan("graph-hop-1", async (hop1Span: Span) => {
        hop1Span.setAttribute("seed_count", vectorResults.length);
        hop1Span.end();
      });

      await tracer.startActiveSpan("graph-hop-2", async (hop2Span: Span) => {
        const graphCtx = await // @ts-expect-error -- rawPool is valid pg Pool at runtime, matches RawPool interface
        expandProductGraph(rawPool, vectorResults, embedding, 2);

        console.log("\n─── Graph RAG (seeds + graph traversal) ───");
        const ctxText = formatGraphContext(graphCtx);
        console.log(ctxText || "  (no graph relationships found — catalog may need collections/facets seeded)");
        hop2Span.setAttribute("graph_nodes", graphCtx.length);
        hop2Span.setAttribute(
          "paired_products",
          graphCtx.reduce((sum, g) => sum + g.pairedProducts.length, 0)
        );
        hop2Span.end();
      });

      span.end();
    });
  }

  await dataSource.destroy();
  await sdk.shutdown();
  console.log("\n─── Demo complete ───");
  process.exit(0);
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error("Demo failed:", msg);
  process.exit(1);
});
