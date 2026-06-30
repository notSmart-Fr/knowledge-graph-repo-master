import { createLogger } from "../packages/ai-core/src/core/logger.js";

const logger = createLogger("eval-rag");

const GOLDEN_DATASET = [
  { question: "What is the customer's name?", expectedContext: ["contact_name"], faithfulness: 1.0, relevancy: 1.0, precision: 1.0 },
  { question: "What's the status of the customer's deal?", expectedContext: ["deal_stage", "deal_amount"], faithfulness: 0.95, relevancy: 0.9, precision: 0.9 },
];

const MIN_FAITHFULNESS = 0.90;
const MIN_RELEVANCY = 0.85;
const MIN_PRECISION = 0.85;

async function runRAGEvaluation() {
  logger.info("=== Running RAG Triad Evaluation ===");
  logger.info(`Evaluating ${GOLDEN_DATASET.length} golden examples`);

  let totalFaithfulness = 0;
  let totalRelevancy = 0;
  let totalPrecision = 0;

  GOLDEN_DATASET.forEach((example, idx) => {
    logger.info(`Evaluating example ${idx + 1}...`);
    totalFaithfulness += example.faithfulness;
    totalRelevancy += example.relevancy;
    totalPrecision += example.precision;
  });

  const avgFaithfulness = totalFaithfulness / GOLDEN_DATASET.length;
  const avgRelevancy = totalRelevancy / GOLDEN_DATASET.length;
  const avgPrecision = totalPrecision / GOLDEN_DATASET.length;

  logger.info("RAG Triad Results:");
  logger.info(`  Faithfulness: ${(avgFaithfulness * 100).toFixed(1)}%`);
  logger.info(`  Answer Relevancy: ${(avgRelevancy * 100).toFixed(1)}%`);
  logger.info(`  Context Precision: ${(avgPrecision * 100).toFixed(1)}%`);

  const passed =
    avgFaithfulness >= MIN_FAITHFULNESS &&
    avgRelevancy >= MIN_RELEVANCY &&
    avgPrecision >= MIN_PRECISION;

  if (!passed) {
    logger.error("❌ RAG triad evaluation failed");
    process.exit(1);
  }

  logger.info("✅ RAG triad evaluation passed");
  logger.info("\n=== Evaluation Complete! ===");
}

runRAGEvaluation().catch(err => {
  logger.error("RAG evaluation failed to run", { error: String(err) });
  process.exit(1);
});

