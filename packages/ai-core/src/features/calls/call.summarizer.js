export async function summarizeCall(callId, callStore, agentProvider) {
    // TODO: Implement call summarization using call.summarizer agent
    const emptyContext = { deals: [], tickets: [], calls: [] };
    const response = await agentProvider.generate(emptyContext);
    return response;
}
