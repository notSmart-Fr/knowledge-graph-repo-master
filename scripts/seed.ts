/**
 * Seed Data Script
 *
 * Populates Supabase with test data:
 * - 5 accounts
 * - 25 contacts (5 per account)
 * - 15 deals across pipeline stages
 * - 8 calls
 * - 5 tickets
 *
 * Usage: bun run scripts/seed.ts
 */

import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { createLogger } from "../packages/ai-core/src/core/logger.js";

const logger = createLogger("seed");

// Database types
interface Account {
  id: string;
  name: string;
  industry: string;
  size: "small" | "medium" | "enterprise";
  health_score: number;
  created_at: string;
}

interface Contact {
  id: string;
  name: string;
  phone: string;
  email: string;
  account_id: string | null;
  role: "lead" | "contact" | "decision_maker";
  tags: string[];
  agent_id: string | null;
  created_at: string;
}

interface PipelineStage {
  id: string;
  name: string;
  sort_order: number;
  probability: number;
  created_at: string;
}

interface Deal {
  id: string;
  name: string;
  amount: number;
  stage: string;
  contact_id: string;
  account_id: string | null;
  probability: number;
  expected_close: string | null;
  agent_id: string | null;
  created_at: string;
}

interface Call {
  id: string;
  contact_id: string;
  agent_id: string | null;
  direction: "inbound" | "outbound";
  transcript_json: Record<string, unknown>;
  summary: string;
  sentiment: "positive" | "neutral" | "negative";
  action_items: string[];
  duration_sec: number;
  created_at: string;
}

interface Ticket {
  id: string;
  contact_id: string;
  subject: string;
  status: "open" | "in_progress" | "closed" | "on_hold";
  priority: "low" | "medium" | "high" | "urgent";
  agent_id: string | null;
  created_at: string;
}

// Seed data
const ACCOUNT_DATA = [
  { name: "Acme Corporation", industry: "Technology", size: "enterprise" as const, health_score: 85 },
  { name: "Global Tech Inc", industry: "Software", size: "medium" as const, health_score: 72 },
  { name: "StartupXYZ", industry: "SaaS", size: "small" as const, health_score: 90 },
  { name: "Enterprise Solutions", industry: "Consulting", size: "enterprise" as const, health_score: 68 },
  { name: "Digital Dynamics", industry: "E-commerce", size: "medium" as const, health_score: 78 },
];

const PIPELINE_STAGES = [
  { name: "Discovery", sort_order: 1, probability: 10 },
  { name: "Qualification", sort_order: 2, probability: 25 },
  { name: "Proposal", sort_order: 3, probability: 50 },
  { name: "Negotiation", sort_order: 4, probability: 75 },
  { name: "Closed Won", sort_order: 5, probability: 100 },
  { name: "Closed Lost", sort_order: 6, probability: 0 },
];

const CONTACT_NAMES = [
  "Alice Johnson", "Bob Smith", "Carol Williams", "David Brown", "Eva Martinez",
  "Frank Garcia", "Grace Lee", "Henry Wilson", "Iris Chen", "Jack Taylor",
  "Karen Anderson", "Leo Thomas", "Maria Rodriguez", "Nathan Moore", "Olivia Jackson",
  "Paul White", "Quinn Harris", "Rachel Martin", "Sam Thompson", "Tina Garcia",
  "Uma Singh", "Victor Lee", "Wendy Clark", "Xavier Lewis", "Yara Walker",
];

const TICKET_SUBJECTS = [
  "Invoice discrepancy for Q4",
  "Feature request: Dashboard export",
  "Integration support needed",
  "Password reset assistance",
  "Contract renewal question",
];

function generatePhone(index: number): string {
  const areaCode = 200 + (index % 800);
  const exchange = 100 + (index % 900);
  const subscriber = 1000 + (index % 9000);
  return `+1${areaCode}${exchange}${subscriber}`;
}

function generateEmail(name: string): string {
  const [first, last] = name.toLowerCase().split(" ");
  const domains = ["company.com", "enterprise.io", "tech.co", "business.net"];
  return `${first}.${last}@${domains[Math.abs(name.charCodeAt(0)) % domains.length]}`;
}

async function seedAccounts(client: SupabaseClient): Promise<Account[]> {
  logger.info("Seeding accounts...");

  const accounts: Account[] = [];

  for (const data of ACCOUNT_DATA) {
    const { data: account, error } = await client
      .from("accounts")
      .insert(data as Record<string, unknown>)
      .select()
      .single();

    if (error) {
      logger.error(`Failed to insert account: ${data.name}`, { error });
      throw error;
    }

    accounts.push(account);
    logger.info(`Created account: ${account.name}`);
  }

  return accounts;
}

async function seedPipelineStages(client: SupabaseClient): Promise<PipelineStage[]> {
  logger.info("Seeding pipeline stages...");

  const stages: PipelineStage[] = [];

  for (const data of PIPELINE_STAGES) {
    const { data: stage, error } = await client
      .from("pipeline_stages")
      .insert(data)
      .select()
      .single();

    if (error) {
      logger.error(`Failed to insert stage: ${data.name}`, { error });
      throw error;
    }

    stages.push(stage);
    logger.info(`Created stage: ${stage.name}`);
  }

  return stages;
}

async function seedContacts(client: SupabaseClient, accounts: Account[]): Promise<Contact[]> {
  logger.info("Seeding contacts...");

  const contacts: Contact[] = [];

  for (let i = 0; i < CONTACT_NAMES.length; i++) {
    const name = CONTACT_NAMES[i];
    const accountIndex = i % accounts.length;
    const roles: Contact["role"][] = ["lead", "contact", "decision_maker"];
    const role = roles[i % 3];

    const contactData = {
      name,
      phone: generatePhone(i),
      email: generateEmail(name),
      account_id: accounts[accountIndex]?.id || null,
      role,
      tags: [accountIndex % 2 === 0 ? "vip" : "standard", role],
      agent_id: null,
    };

    const { data: contact, error } = await client
      .from("contacts")
      .insert(contactData)
      .select()
      .single();

    if (error) {
      logger.error(`Failed to insert contact: ${name}`, { error });
      throw error;
    }

    contacts.push(contact);
  }

  logger.info(`Created ${contacts.length} contacts`);
  return contacts;
}

async function seedDeals(
  client: SupabaseClient,
  contacts: Contact[],
  stages: PipelineStage[]
): Promise<Deal[]> {
  logger.info("Seeding deals...");

  const deals: Deal[] = [];
  const dealNames = [
    "Enterprise License", "Platform Subscription", "Consulting Services",
    "Custom Integration", "Training Package", "Support Contract",
    "Annual Renewal", "Pilot Program", "Expansion Deal",
    "Migration Project", "API Access", "Premium Support",
    "Data Analytics Suite", "Security Audit", "Implementation Services",
  ];

  for (let i = 0; i < 15; i++) {
    const contact = contacts[i % contacts.length];
    const stageIndex = i % stages.length;
    const stage = stages[stageIndex];

    const amounts = [5000, 15000, 25000, 50000, 75000, 100000, 150000, 200000];
    const amount = amounts[i % amounts.length];

    const dealData = {
      name: dealNames[i],
      amount,
      stage: stage.id,
      contact_id: contact.id,
      account_id: contact.account_id,
      probability: stage.probability,
      expected_close: new Date(Date.now() + (30 + i * 15) * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
      agent_id: null,
    };

    const { data: deal, error } = await client
      .from("deals")
      .insert(dealData)
      .select()
      .single();

    if (error) {
      logger.error(`Failed to insert deal: ${dealNames[i]}`, { error });
      throw error;
    }

    deals.push(deal);
  }

  logger.info(`Created ${deals.length} deals`);
  return deals;
}

async function seedCalls(client: SupabaseClient, contacts: Contact[]): Promise<Call[]> {
  logger.info("Seeding calls...");

  const calls: Call[] = [];
  const sentiments: Call["sentiment"][] = ["positive", "neutral", "negative"];

  for (let i = 0; i < 8; i++) {
    const contact = contacts[i % contacts.length];
    const direction: Call["direction"] = i % 2 === 0 ? "inbound" : "outbound";

    const callData = {
      contact_id: contact.id,
      agent_id: null,
      direction,
      transcript_json: {
        segments: [
          { speaker: "customer", text: "Hello, I have a question about my account." },
          { speaker: "agent", text: "Of course, how can I help you today?" },
          { speaker: "customer", text: "I wanted to check the status of my recent order." },
        ],
      },
      summary: `Call with ${contact.name} regarding order status inquiry.`,
      sentiment: sentiments[i % 3],
      action_items: ["Follow up on order status", "Send confirmation email"],
      duration_sec: 300 + i * 60,
    };

    const { data: call, error } = await client
      .from("calls")
      .insert(callData)
      .select()
      .single();

    if (error) {
      logger.error(`Failed to insert call`, { error });
      throw error;
    }

    calls.push(call);
  }

  logger.info(`Created ${calls.length} calls`);
  return calls;
}

async function seedTickets(client: SupabaseClient, contacts: Contact[]): Promise<Ticket[]> {
  logger.info("Seeding tickets...");

  const tickets: Ticket[] = [];
  const statuses: Ticket["status"][] = ["open", "in_progress", "closed", "on_hold"];
  const priorities: Ticket["priority"][] = ["low", "medium", "high", "urgent"];

  for (let i = 0; i < 5; i++) {
    const contact = contacts[i % contacts.length];

    const ticketData = {
      contact_id: contact.id,
      subject: TICKET_SUBJECTS[i],
      status: statuses[i % statuses.length],
      priority: priorities[i % priorities.length],
      agent_id: null,
    };

    const { data: ticket, error } = await client
      .from("support_tickets")
      .insert(ticketData)
      .select()
      .single();

    if (error) {
      logger.error(`Failed to insert ticket: ${TICKET_SUBJECTS[i]}`, { error });
      throw error;
    }

    tickets.push(ticket);
  }

  logger.info(`Created ${tickets.length} tickets`);
  return tickets;
}

export async function runSeed(): Promise<void> {
  logger.info("Starting seed script...");

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SECRET_KEY;

  if (!supabaseUrl || !supabaseKey) {
    logger.error("Missing SUPABASE_URL or SUPABASE_SECRET_KEY");
    throw new Error("Missing Supabase environment variables");
  }

  const client = createClient(supabaseUrl, supabaseKey);

  try {
    // Seed in order (FK constraints)
    const accounts = await seedAccounts(client);
    const stages = await seedPipelineStages(client);
    const contacts = await seedContacts(client, accounts);
    await seedDeals(client, contacts, stages);
    await seedCalls(client, contacts);
    await seedTickets(client, contacts);

    logger.info("Seed completed successfully!", {
      accounts: accounts.length,
      contacts: contacts.length,
      deals: 15,
      calls: 8,
      tickets: 5,
    });
  } catch (error: unknown) {
    logger.error("Seed failed", { error: String(error) });
    throw error;
  }
}

// Run if executed directly
if (import.meta.main) {
  runSeed()
    .then(() => {
      console.log("\n✓ Seed completed successfully!");
      process.exit(0);
    })
    .catch((error) => {
      console.error("\n✗ Seed failed:", error);
      process.exit(1);
    });
}
