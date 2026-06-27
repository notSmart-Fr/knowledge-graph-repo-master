import { CRMGraphContextSchema } from "../../core/ports.js";
export class NoOpGraphRetriever {
    async expandFromContact(contactId) {
        return CRMGraphContextSchema.parse({
            deals: [],
            tickets: [],
            calls: [],
        });
    }
    async expandFromDeal(dealId) {
        return CRMGraphContextSchema.parse({
            deals: [],
            tickets: [],
            calls: [],
        });
    }
    async getStaleDeals(days) {
        return [];
    }
}
