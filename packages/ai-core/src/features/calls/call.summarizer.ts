
import { ICallStore, IAgentProvider, CRMGraphContext } from "../../core/ports";

export async function summarizeCall(
  callId: string,
  callStore: ICallStore,
  agentProvider: IAgentProvider
) {
  // TODO: Implement call summarization using call.summarizer agent
  const emptyContext: CRMGraphContext = { deals: [], tickets: [], calls: [] };
  const response = await agentProvider.generate(emptyContext);
  return response;
}
