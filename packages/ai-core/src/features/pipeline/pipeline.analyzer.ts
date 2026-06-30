
import { IGraphRetriever } from "../../core/ports.js";
import { createPipelineAnalyzer } from "../../agents/pipeline-analyzer.js";
import { createLogger } from "../../core/logger.js";

const logger = createLogger("pipeline-analyzer-feature");

export async function analyzePipeline(
  graphRetriever: IGraphRetriever,
  staleDays: number = 30
) {
  const staleDeals = await graphRetriever.getStaleDeals(staleDays);
  const analyzer = createPipelineAnalyzer();
  const report = await analyzer.analyzeStaleDeals(staleDeals);
  logger.info("Pipeline analysis complete", { staleDays, dealCount: staleDeals.length });
  return report;
}
