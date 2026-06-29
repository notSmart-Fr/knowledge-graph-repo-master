import { z } from "zod";
export function createDealTools(dealStore) {
    return {
        getDeals: {
            id: "getDeals",
            description: "Retrieve all deals associated with a specific contact ID to see their pipeline stages and amounts.",
            inputSchema: z.object({
                contactId: z.string().describe("The ID of the contact to get deals for"),
            }),
            execute: async (input) => {
                return await dealStore.getByContact(input.contactId);
            },
        },
        updateDeal: {
            id: "updateDeal",
            description: "Update fields on an existing deal such as stage, amount, probability, or expected close date.",
            inputSchema: z.object({
                dealId: z.string().describe("The ID of the deal to update"),
                fields: z.object({
                    name: z.string().optional(),
                    amount: z.number().optional(),
                    stage: z.string().optional(),
                    probability: z.number().min(0).max(100).optional(),
                    expectedClose: z.string().datetime().optional(),
                }),
            }),
            execute: async (input) => {
                return await dealStore.update(input.dealId, input.fields);
            },
        },
    };
}
