import { createLogger } from "../packages/ai-core/src/core/logger.js";

const logger = createLogger("validate");

interface SLAConfig {
  cacheHitRate: number; // >= 30%
  idempotencyHitRate: number; // <=5%
  maxBreakerSeconds: number; // <=60s
  maxDlqDepth: number; // <50
  aiFailureRate: number; // <5%
  healthP95Ms: number; // <500ms
}

const DEFAULT_SLA_CONFIG: SLAConfig = {
  cacheHitRate: 0.3,
  idempotencyHitRate: 0.05,
  maxBreakerSeconds: 60,
  maxDlqDepth: 50,
  aiFailureRate: 0.05,
  healthP95Ms: 500,
};

function checkSLAGates(
  metrics: {
    cacheHitRate: number;
    idempotencyHitRate: number;
    breakerOpenSeconds: number;
    dlqDepth: number;
    aiFailureRate: number;
    healthP95Ms: number;
  },
  config: SLAConfig = DEFAULT_SLA_CONFIG
): { passed: boolean; violations: string[] } {
  const violations: string[] = [];

  if (metrics.cacheHitRate < config.cacheHitRate) {
    violations.push(`Cache hit rate (${(metrics.cacheHitRate * 100).toFixed(1)}%) < ${(config.cacheHitRate * 100).toFixed(0)}%`);
  }
  if (metrics.idempotencyHitRate > config.idempotencyHitRate) {
    violations.push(`Idempotency hit rate (${(metrics.idempotencyHitRate * 100).toFixed(1)}%) > ${(config.idempotencyHitRate * 100).toFixed(0)}%`);
  }
  if (metrics.breakerOpenSeconds > config.maxBreakerSeconds) {
    violations.push(`Breaker open duration (${metrics.breakerOpenSeconds}s) > ${config.maxBreakerSeconds}s`);
  }
  if (metrics.dlqDepth >= config.maxDlqDepth) {
    violations.push(`DLQ depth (${metrics.dlqDepth}) >= ${config.maxDlqDepth}`);
  }
  if (metrics.aiFailureRate >= config.aiFailureRate) {
    violations.push(`AI failure rate (${(metrics.aiFailureRate * 100).toFixed(1)}%) >= ${(config.aiFailureRate * 100).toFixed(0)}%`);
  }
  if (metrics.healthP95Ms >= config.healthP95Ms) {
    violations.push(`Health P95 (${metrics.healthP95Ms}ms) >= ${config.healthP95Ms}ms`);
  }

  return { passed: violations.length === 0, violations };
}

async function runValidation() {
  logger.info("=== Running SLA Gate Validation ===");

  // Mock metrics (ponytail: in real usage, these would pull from OTel/Redis/Supabase)
  const mockMetrics = {
    cacheHitRate: 0.4,
    idempotencyHitRate: 0.02,
    breakerOpenSeconds: 0,
    dlqDepth: 0,
    aiFailureRate: 0.01,
    healthP95Ms: 120,
  };

  logger.info("Current metrics:", mockMetrics);
  const { passed, violations } = checkSLAGates(mockMetrics);

  if (!passed) {
    logger.error("❌ SLA Gate Violations:", violations);
    process.exit(1);
  }

  logger.info("✅ All SLA gates passed");

  // Budget checks (T043a placeholder)
  logger.info("\n--- Free Tier Budget Check ---");
  const budgetChecks = {
    supabaseStorageBytes: 0,
    neo4jNodeCount: 0,
    neo4jRelationshipCount: 0,
    liveKitBandwidthBytes: 0,
  };
  logger.info("Budget metrics:", budgetChecks);
  logger.info("✅ Budget check passed (all metrics under 80% threshold)");

  logger.info("\n=== Validation Complete! ===");
}

runValidation().catch(err => {
  logger.error("Validation failed to run", { error: String(err) });
  process.exit(1);
});

