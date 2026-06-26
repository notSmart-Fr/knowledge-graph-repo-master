/**
 * eval-rag.ts — Retrieval quality benchmark for vector search
 *
 * Usage:
 *   node --no-warnings --experimental-strip-types scripts/eval-rag.ts
 *
 * Requires: Postgres with product embeddings + env files configured.
 */

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadMonorepoEnv } from "./load-env.ts";
loadMonorepoEnv();

import { Kysely, PostgresDialect, sql } from "kysely";
import { getDbPool } from "@dtc/ai-core/db-pool";

interface EvalCase {
  query: string;
  expectedSlugs: string[];
}

interface EvalResult {
  query: string;
  expectedSlugs: string[];
  retrievedSlugs: string[];
  recallAt3: number;
  reciprocalRank: number;
}

const EVAL_CASES: EvalCase[] = [
  { query: "classic cotton t-shirt", expectedSlugs: ["t-shirt"] },
  { query: "black tee shirt", expectedSlugs: ["t-shirt"] },
  { query: "white cotton t-shirt", expectedSlugs: ["t-shirt"] },
  { query: "comfortable sweatshirt", expectedSlugs: ["sweatshirt"] },
  { query: "gray pullover hoodie style sweatshirt", expectedSlugs: ["sweatshirt"] },
  { query: "warm sweatshirt for layering", expectedSlugs: ["sweatshirt"] },
  { query: "cotton sweatpants", expectedSlugs: ["sweatpants"] },
  { query: "jogger sweat pants", expectedSlugs: ["sweatpants"] },
  { query: "lounge sweatpants", expectedSlugs: ["sweatpants"] },
  { query: "summer shorts", expectedSlugs: ["shorts"] },
  { query: "black athletic shorts", expectedSlugs: ["shorts"] },
  { query: "casual shorts cotton", expectedSlugs: ["shorts"] },
  { query: "matching top and bottom set", expectedSlugs: ["sweatshirt", "sweatpants"] },
  { query: "workout outfit essentials", expectedSlugs: ["shorts", "sweatpants", "t-shirt"] },
  { query: "everyday cotton essentials", expectedSlugs: ["t-shirt", "sweatshirt"] },
  { query: "everyday apparel basics", expectedSlugs: ["t-shirt", "sweatshirt", "shorts", "sweatpants"] },
  { query: "cozy weekend outfit", expectedSlugs: ["sweatshirt", "sweatpants"] },
  { query: "lightweight summer top", expectedSlugs: ["t-shirt", "shorts"] },
];

function computeRecallAtK(expected: string[], retrieved: string[], k: number): number {
  if (expected.length === 0) return 0;
  const topK = retrieved.slice(0, k);
  const hits = expected.filter((slug) => topK.includes(slug)).length;
  return hits / expected.length;
}

function computeMrr(expected: string[], retrieved: string[]): number {
  for (let i = 0; i < retrieved.length; i += 1) {
    if (expected.includes(retrieved[i])) {
      return 1 / (i + 1);
    }
  }
  return 0;
}

async function main() {
  const rawPool = getDbPool();

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
    dialect: new PostgresDialect({ pool: rawPool }),
  });

  const { getEmbedding } = await import("@dtc/ai-core/cache-engine");

  const results: EvalResult[] = [];

  for (const evalCase of EVAL_CASES) {
    const embedding = await getEmbedding(evalCase.query);
    const vectorLiteral = `[${embedding.join(",")}]`;

    const matches = await db
      .selectFrom("product as p")
      .innerJoin("product_translation as pt", "pt.baseId", "p.id")
      .select(["pt.slug"])
      .where("p.deletedAt", "is", null)
      .orderBy(
        sql`p."customFieldsEmbedding" <=> cast(${vectorLiteral} as vector)`,
        "asc",
      )
      .limit(3)
      .execute();

    const retrievedSlugs = matches.map((row) => row.slug);
    const recallAt3 = computeRecallAtK(
      evalCase.expectedSlugs,
      retrievedSlugs,
      3,
    );
    const reciprocalRank = computeMrr(evalCase.expectedSlugs, retrievedSlugs);

    results.push({
      query: evalCase.query,
      expectedSlugs: evalCase.expectedSlugs,
      retrievedSlugs,
      recallAt3,
      reciprocalRank,
    });

    console.log(
      `[${recallAt3 === 1 ? "PASS" : "MISS"}] "${evalCase.query}" -> ${retrievedSlugs.join(", ") || "(none)"}`,
    );
  }

  const meanRecallAt3 =
    results.reduce((sum, row) => sum + row.recallAt3, 0) / results.length;
  const meanMrr =
    results.reduce((sum, row) => sum + row.reciprocalRank, 0) / results.length;

  const report = {
    generatedAt: new Date().toISOString(),
    caseCount: results.length,
    meanRecallAt3,
    meanMrr,
    results,
  };

  const reportPath = resolve(process.cwd(), "scripts/eval-rag-report.json");
  writeFileSync(reportPath, JSON.stringify(report, null, 2));

  console.log("\n=== RAG Evaluation Summary ===");
  console.log(`Cases: ${results.length}`);
  console.log(`Mean Recall@3: ${(meanRecallAt3 * 100).toFixed(1)}%`);
  console.log(`Mean MRR: ${meanMrr.toFixed(3)}`);
  console.log(`Report: ${reportPath}`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error("RAG evaluation failed:", message);
  process.exit(1);
});
