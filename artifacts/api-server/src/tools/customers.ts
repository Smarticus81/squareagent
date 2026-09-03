/**
 * Customer tools — search, create, get, update Square customers.
 */

import type { ToolDefinition, ToolExecutor, ToolContext, ToolResult } from "./types";
import { idempotencyKey, squareErrorMessage } from "../lib/square-helpers";
import { squareFromCtx, idempotencySeed, venueTimeZone, NOT_CONNECTED } from "./_square";
import { formatLocalDate } from "../lib/venue-time";

// ── Definitions ───────────────────────────────────────────────────────────────

export const definitions: ToolDefinition[] = [
  {
    type: "function",
    name: "search_customer",
    description: "Search for a customer by name, email, or phone number",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Name, email, or phone number to search" },
      },
      required: ["query"],
    },
  },
  {
    type: "function",
    name: "create_customer",
    description: "Create a new customer profile in Square",
    parameters: {
      type: "object",
      properties: {
        given_name: { type: "string", description: "First name" },
        family_name: { type: "string", description: "Last name" },
        email: { type: "string", description: "Email address (optional)" },
        phone: { type: "string", description: "Phone number (optional)" },
        note: { type: "string", description: "Internal note about the customer (optional)" },
      },
      required: ["given_name"],
    },
  },
  {
    type: "function",
    name: "get_customer",
    description: "Get full details of a customer by their ID",
    parameters: {
      type: "object",
      properties: {
        customer_id: { type: "string", description: "Square customer ID" },
      },
      required: ["customer_id"],
    },
  },
  {
    type: "function",
    name: "update_customer",
    description: "Update a customer's information",
    parameters: {
      type: "object",
      properties: {
        customer_id: { type: "string", description: "Square customer ID" },
        given_name: { type: "string", description: "New first name (optional)" },
        family_name: { type: "string", description: "New last name (optional)" },
        email: { type: "string", description: "New email (optional)" },
        phone: { type: "string", description: "New phone (optional)" },
        note: { type: "string", description: "New note (optional)" },
      },
      required: ["customer_id"],
    },
  },
];

// ── Executors ─────────────────────────────────────────────────────────────────

function customerName(c: any): string {
  return `${c?.given_name ?? ""} ${c?.family_name ?? ""}`.trim() || c?.company_name || "Unnamed";
}

function customerLine(c: any): string {
  const email = c.email_address ? ` | ${c.email_address}` : "";
  const phone = c.phone_number ? ` | ${c.phone_number}` : "";
  return `${customerName(c)} (${c.id})${email}${phone}`;
}

function customerBody(args: Record<string, unknown>): Record<string, string> {
  const body: Record<string, string> = {};
  if (args.given_name) body.given_name = String(args.given_name);
  if (args.family_name) body.family_name = String(args.family_name);
  if (args.email) body.email_address = String(args.email);
  if (args.phone) body.phone_number = String(args.phone);
  if (args.note) body.note = String(args.note);
  return body;
}

async function searchCustomer(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const query = String(args.query ?? "").trim();
  if (!query) return { result: "Search query is required." };
  const client = squareFromCtx(ctx);
  if (!client) return NOT_CONNECTED;

  // Square's search filter only fuzzes email/phone. Run that and a recent-
  // customers scan in parallel, then merge, so name lookups don't cost a
  // second round trip after the first comes back empty.
  const looksLikeContact = /[@\d]/.test(query);
  const [filtered, recent] = await Promise.all([
    looksLikeContact
      ? client.post("/customers/search", {
          query: { filter: query.includes("@") ? { email_address: { fuzzy: query } } : { phone_number: { fuzzy: query } } },
          limit: 10,
        })
      : Promise.resolve(null),
    client.post("/customers/search", { query: { sort: { field: "CREATED_AT", order: "DESC" } }, limit: 100 }),
  ]);
  if (filtered && !filtered.ok) return { result: `Failed to search customers: ${squareErrorMessage(filtered.error)}` };
  if (!recent.ok) return { result: `Failed to search customers: ${squareErrorMessage(recent.error)}` };

  const q = query.toLowerCase();
  const digits = q.replace(/\D/g, "");
  const filteredIds = new Set<string>((filtered?.data?.customers ?? []).map((c: any) => c.id));
  const seen = new Set<string>();
  const customers: any[] = [];
  for (const c of [...(filtered?.data?.customers ?? []), ...(recent.data?.customers ?? [])]) {
    if (!c?.id || seen.has(c.id)) continue;
    const matches = filteredIds.has(c.id)
      || customerName(c).toLowerCase().includes(q)
      || (c.email_address ?? "").toLowerCase().includes(q)
      || (digits.length > 0 && String(c.phone_number ?? "").replace(/\D/g, "").includes(digits));
    if (!matches) continue;
    seen.add(c.id);
    customers.push(c);
  }

  if (customers.length === 0) return { result: `No customers found matching "${query}".` };
  return { result: `Customers found:\n${customers.slice(0, 5).map(customerLine).join("\n")}` };
}

async function createCustomer(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const client = squareFromCtx(ctx);
  if (!client) return NOT_CONNECTED;
  const body = customerBody(args);
  if (Object.keys(body).length === 0) return { result: "Need at least a name, email, or phone to create a customer." };
  const res = await client.post("/customers", { ...body, idempotency_key: idempotencyKey("cust", idempotencySeed(ctx, "cust")) });
  if (!res.ok) return { result: `Failed: ${squareErrorMessage(res.error)}` };
  const c = res.data.customer;
  return { result: `Created customer "${customerName(c)}" (ID: ${c.id}).` };
}

async function getCustomer(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const customerId = String(args.customer_id ?? "").trim();
  if (!customerId) return { result: "Customer ID is required." };
  const client = squareFromCtx(ctx);
  if (!client) return NOT_CONNECTED;
  const [res, tz] = await Promise.all([client.get(`/customers/${encodeURIComponent(customerId)}`), venueTimeZone(client)]);
  if (!res.ok) return { result: `Failed: ${squareErrorMessage(res.error, "Customer not found")}` };
  const c = res.data.customer;
  const lines = [
    `Name: ${customerName(c)}`,
    c.email_address ? `Email: ${c.email_address}` : null,
    c.phone_number ? `Phone: ${c.phone_number}` : null,
    `Created: ${formatLocalDate(c.created_at, tz)}`,
    c.note ? `Note: ${c.note}` : null,
    `ID: ${c.id}`,
  ].filter(Boolean);
  return { result: lines.join("\n") };
}

async function updateCustomer(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const customerId = String(args.customer_id ?? "").trim();
  if (!customerId) return { result: "Customer ID is required." };
  const client = squareFromCtx(ctx);
  if (!client) return NOT_CONNECTED;
  const body = customerBody(args);
  if (Object.keys(body).length === 0) return { result: "No changes specified." };
  const res = await client.put(`/customers/${encodeURIComponent(customerId)}`, body);
  if (!res.ok) return { result: `Failed: ${squareErrorMessage(res.error)}` };
  return { result: `Customer ${customerName(res.data.customer)} updated.` };
}

export const executors: Record<string, ToolExecutor> = {
  search_customer: searchCustomer,
  create_customer: createCustomer,
  get_customer: getCustomer,
  update_customer: updateCustomer,
};
