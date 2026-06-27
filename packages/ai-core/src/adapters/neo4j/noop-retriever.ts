import type { IGraphRetriever, CRMGraphContext, Deal } from "../../core/ports.js";
import { CRMGraphContextSchema } from "../../core/ports.js";

export class NoOpGraphRetriever implements IGraphRetriever {
  async expandFromContact(contactId: string): Promise<CRMGraphContext> {
    return CRMGraphContextSchema.parse({
      deals: [],
      tickets: [],
      calls: [],
    });
  }

  async expandFromDeal(dealId: string): Promise<CRMGraphContext> {
    return CRMGraphContextSchema.parse({
      deals: [],
      tickets: [],
      calls: [],
    });
  }

  async getStaleDeals(days: number): Promise<Deal[]> {
    return [];
  }
}
