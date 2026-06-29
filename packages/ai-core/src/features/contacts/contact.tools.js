import { z } from "zod";
export function createContactTools(contactStore) {
    return {
        lookupContact: {
            id: "lookupContact",
            description: "Look up a CRM contact by phone number to retrieve their details including name, account, role, etc.",
            inputSchema: z.object({
                phone: z.string().describe("The phone number of the contact to look up"),
            }),
            execute: async (input) => {
                return await contactStore.getByPhone(input.phone);
            },
        },
    };
}
