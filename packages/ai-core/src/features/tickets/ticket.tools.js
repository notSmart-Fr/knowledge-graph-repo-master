import { z } from "zod";
export function createTicketTools(ticketStore) {
    return {
        getTickets: {
            id: "getTickets",
            description: "Retrieve all support tickets associated with a specific contact ID, including status and priority.",
            inputSchema: z.object({
                contactId: z.string().describe("The ID of the contact to get tickets for"),
            }),
            execute: async (input) => {
                return await ticketStore.getByContact(input.contactId);
            },
        },
        createTicket: {
            id: "createTicket",
            description: "Create a new support ticket for a contact with a subject and priority level.",
            inputSchema: z.object({
                contactId: z.string().describe("The ID of the contact to create a ticket for"),
                subject: z.string().describe("The subject/title of the support ticket"),
                priority: z.enum(["low", "medium", "high", "urgent"]).describe("The priority level of the ticket"),
            }),
            execute: async (input) => {
                return await ticketStore.create({
                    contactId: input.contactId,
                    subject: input.subject,
                    priority: input.priority,
                    status: "open",
                });
            },
        },
    };
}
