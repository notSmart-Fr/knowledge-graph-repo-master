
import { IGraphRetriever, IAgentProvider, CRMGraphContext } from "../../core/ports";

export async function analyzePipeline(
  graphRetriever: IGraphRetriever,
  agentProvider: IAgentProvider,
  staleDays: number = 14
) {
  // TODO: Implement pipeline analysis using pipeline.analyzer agent
  const staleDeals = await graphRetriever.getStaleDeals(staleDays);
  const emptyContext: CRMGraphContext = { deals: staleDeals, tickets: [], calls: [] };
  const response = await agentProvider.generate(emptyContext);
  return response;
}
