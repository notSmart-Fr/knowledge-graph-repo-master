
import { z } from "zod";
import { IContactStore } from "../../core/ports";

export function createContactTools(contactStore: IContactStore) {
  return {
    lookupContact: {
      id: "lookupContact",
      description: "Look up a CRM contact by phone number to retrieve their details including name, account, role, etc.",
      inputSchema: z.object({
        phone: z.string().describe("The phone number of the contact to look up"),
      }),
      execute: async (input: { phone: string }) => {
        return await contactStore.getByPhone(input.phone);
      },
    },
  };
}
