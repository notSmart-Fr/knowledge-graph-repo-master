import type { Deal } from "../core/ports.js";
import { timeService } from "../core/time-service.js";
import { createLogger } from "../core/logger.js";

const logger = createLogger("pipeline-analyzer");

export class PipelineAnalyzer {
  async analyzeStaleDeals(deals: Deal[]): Promise<string> {
    const summary = `Pipeline Analysis Report (${timeService.toISO()})
Total Stale Deals (>30 days without stage change): ${deals.length}

Details:
${deals.map(d => `- Deal "${d.name}": ${d.stage}, $${d.amount.toLocaleString()}, Created at: ${d.createdAt}`).join("\n")}
`;

    logger.info("Generated pipeline analysis report", { dealCount: deals.length });
    return summary;
  }
}

export function createPipelineAnalyzer(): PipelineAnalyzer {
  return new PipelineAnalyzer();
}

