/**
 * Customer tools — search, create, get, update Square customers.
 */

import type { ToolDefinition, ToolExecutor, ToolContext, ToolResult } from "./types";
import { SQUARE_BASE, squareHeaders } from "../lib/square-helpers";

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

async function searchCustomer(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const query = String(args.query ?? "");
  if (!query) return { result: "Search query is required." };
  if (!ctx.squareToken) return { result: "Square not connected." };
  try {
    const res = await fetch(`${SQUARE_BASE}/customers/search`, {
      method: "POST",
      headers: squareHeaders(ctx.squareToken),
      body: JSON.stringify({
        query: {
          filter: {
            email_address: { fuzzy: query },
            phone_number: { fuzzy: query },
          },
        },
        limit: 10,
      }),
    });
    // Square search can be picky — also try a general text search if needed
    const data = (await res.json()) as any;
    let customers = data.customers ?? [];

    // If no results, try searching by display name
    if (customers.length === 0) {
      const res2 = await fetch(`${SQUARE_BASE}/customers/search`, {
        method: "POST",
        headers: squareHeaders(ctx.squareToken),
        body: JSON.stringify({
          query: {
            filter: {},
            sort: { field: "CREATED_AT", order: "DESC" },
          },
          limit: 50,
        }),
      });
      const data2 = (await res2.json()) as any;
      const all = data2.customers ?? [];
      const q = query.toLowerCase();
      customers = all.filter((c: any) => {
        const name = `${c.given_name ?? ""} ${c.family_name ?? ""}`.toLowerCase();
        return name.includes(q) || (c.email_address ?? "").toLowerCase().includes(q) || (c.phone_number ?? "").includes(q);
      });
    }

    if (customers.length === 0) return { result: `No customers found matching "${query}".` };
    const lines = customers.slice(0, 5).map((c: any) => {
      const name = `${c.given_name ?? ""} ${c.family_name ?? ""}`.trim() || "Unnamed";
      const email = c.email_address ? ` | ${c.email_address}` : "";
      const phone = c.phone_number ? ` | ${c.phone_number}` : "";
      return `${name} (${c.id})${email}${phone}`;
    });
    return { result: `Customers found:\n${lines.join("\n")}` };
  } catch (e: any) {
    return { result: `Failed to search customers: ${e.message}` };
  }
}

async function createCustomer(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  if (!ctx.squareToken) return { result: "Square not connected." };
  const body: any = {};
  if (args.given_name) body.given_name = String(args.given_name);
  if (args.family_name) body.family_name = String(args.family_name);
  if (args.email) body.email_address = String(args.email);
  if (args.phone) body.phone_number = String(args.phone);
  if (args.note) body.note = String(args.note);
  body.idempotency_key = `cust-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  try {
    const res = await fetch(`${SQUARE_BASE}/customers`, {
      method: "POST",
      headers: squareHeaders(ctx.squareToken),
      body: JSON.stringify(body),
    });
    const data = (await res.json()) as any;
    if (!res.ok) return { result: `Failed: ${data.errors?.[0]?.detail ?? "Unknown error"}` };
    const c = data.customer;
    const name = `${c.given_name ?? ""} ${c.family_name ?? ""}`.trim();
    return { result: `Created customer "${name}" (ID: ${c.id}).` };
  } catch (e: any) {
    return { result: `Failed to create customer: ${e.message}` };
  }
}

async function getCustomer(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const customerId = String(args.customer_id ?? "");
  if (!customerId) return { result: "Customer ID is required." };
  if (!ctx.squareToken) return { result: "Square not connected." };
  try {
    const res = await fetch(`${SQUARE_BASE}/customers/${customerId}`, {
      headers: squareHeaders(ctx.squareToken),
    });
    const data = (await res.json()) as any;
    if (!res.ok) return { result: `Failed: ${data.errors?.[0]?.detail ?? "Customer not found"}` };
    const c = data.customer;
    const lines = [
      `Name: ${c.given_name ?? ""} ${c.family_name ?? ""}`.trim(),
      c.email_address ? `Email: ${c.email_address}` : null,
      c.phone_number ? `Phone: ${c.phone_number}` : null,
      `Created: ${c.created_at ? new Date(c.created_at).toLocaleDateString() : "?"}`,
      c.note ? `Note: ${c.note}` : null,
      `ID: ${c.id}`,
    ].filter(Boolean);
    return { result: lines.join("\n") };
  } catch (e: any) {
    return { result: `Failed to get customer: ${e.message}` };
  }
}

async function updateCustomer(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const customerId = String(args.customer_id ?? "");
  if (!customerId) return { result: "Customer ID is required." };
  if (!ctx.squareToken) return { result: "Square not connected." };
  const body: any = {};
  if (args.given_name) body.given_name = String(args.given_name);
  if (args.family_name) body.family_name = String(args.family_name);
  if (args.email) body.email_address = String(args.email);
  if (args.phone) body.phone_number = String(args.phone);
  if (args.note) body.note = String(args.note);

  try {
    const res = await fetch(`${SQUARE_BASE}/customers/${customerId}`, {
      method: "PUT",
      headers: squareHeaders(ctx.squareToken),
      body: JSON.stringify(body),
    });
    const data = (await res.json()) as any;
    if (!res.ok) return { result: `Failed: ${data.errors?.[0]?.detail ?? "Unknown error"}` };
    return { result: `Customer ${customerId} updated.` };
  } catch (e: any) {
    return { result: `Failed to update customer: ${e.message}` };
  }
}

// ── Export executor map ───────────────────────────────────────────────────────

export const executors: Record<string, ToolExecutor> = {
  search_customer: searchCustomer,
  create_customer: createCustomer,
  get_customer: getCustomer,
  update_customer: updateCustomer,
};
