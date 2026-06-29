export async function analyzePipeline(graphRetriever, agentProvider, staleDays = 14) {
    // TODO: Implement pipeline analysis using pipeline.analyzer agent
    const staleDeals = await graphRetriever.getStaleDeals(staleDays);
    const emptyContext = { deals: staleDeals, tickets: [], calls: [] };
    const response = await agentProvider.generate(emptyContext);
    return response;
}
