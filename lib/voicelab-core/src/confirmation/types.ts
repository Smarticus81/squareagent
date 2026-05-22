/**
 * Confirmation policy gates how risky a tool call is and whether the
 * agent must request explicit verbal/visual confirmation before executing.
 *
 * Risk levels are derived from tool metadata combined with venue noise mode.
 */

import type { NoiseMode } from "../noise/types";

export type ToolRiskLevel = "low" | "medium" | "high" | "destructive";

export interface ToolRiskMetadata {
  toolName: string;
  riskLevel: ToolRiskLevel;
  /** Free-form rationale; e.g. "writes order to POS". */
  reason?: string;
}

export interface ConfirmationPolicy {
  /** Always require confirmation for these tools regardless of noise mode. */
  alwaysConfirm: string[];
  /** Never require confirmation for these tools (read-only safe). */
  neverConfirm: string[];
  /** Risk level cutoff at which confirmation is required for the given mode. */
  thresholdByNoiseMode: Record<NoiseMode, ToolRiskLevel>;
}

export const DEFAULT_CONFIRMATION_POLICY: ConfirmationPolicy = {
  alwaysConfirm: ["submit_order", "send_to_terminal", "refund_payment", "cancel_order", "delete_item"],
  neverConfirm: [
    "search_menu",
    "get_order",
    "list_orders",
    "list_locations",
    "list_categories",
    "list_modifiers",
    "list_open_orders",
    "list_payments",
    "search_customer",
    "get_customer",
    "list_team",
    "current_shifts",
    "check_inventory",
    "check_all_inventory",
    "low_stock_report",
    "inventory_summary",
    "daily_summary",
    "sales_report",
    "hourly_sales",
    "item_performance",
    "get_inventory_changes",
    "get_item_details",
    "get_order_details",
    // General assistant — read-only
    "list_inbox",
    "search_email",
    "read_email",
    "mark_email_read",
    "search_knowledge",
    "list_knowledge",
    "web_search",
    "fetch_url",
    "query_database",
    "list_database_connections",
    "create_email_draft",
  ],
  thresholdByNoiseMode: {
    quiet_room: "high",
    restaurant: "medium",
    bar: "medium",
    nightclub: "low",
    event_venue: "medium",
    manual_push_to_talk: "low",
  },
};

const RISK_RANK: Record<ToolRiskLevel, number> = {
  low: 0,
  medium: 1,
  high: 2,
  destructive: 3,
};

/**
 * Pure decision function. Returns true when the agent must request
 * confirmation before executing a tool.
 */
export function requiresConfirmation(
  toolName: string,
  riskLevel: ToolRiskLevel,
  noiseMode: NoiseMode,
  policy: ConfirmationPolicy = DEFAULT_CONFIRMATION_POLICY,
): boolean {
  if (policy.alwaysConfirm.includes(toolName)) return true;
  if (policy.neverConfirm.includes(toolName)) return false;
  const threshold = policy.thresholdByNoiseMode[noiseMode];
  return RISK_RANK[riskLevel] >= RISK_RANK[threshold];
}

export const TOOL_RISK_DEFAULTS: Record<string, ToolRiskLevel> = {
  // POS writes
  add_item: "low",
  remove_item: "low",
  clear_order: "medium",
  submit_order: "destructive",
  send_to_terminal: "destructive",
  // Catalog management
  create_item: "high",
  update_item: "high",
  delete_item: "destructive",
  apply_discount: "medium",
  create_category: "medium",
  // Inventory writes
  adjust_inventory: "high",
  set_inventory: "high",
  transfer_inventory: "high",
  batch_adjust_inventory: "destructive",
  // Customers
  create_customer: "low",
  update_customer: "medium",
  // Payments
  refund_payment: "destructive",
  cancel_payment: "destructive",
  // Team
  clock_in: "low",
  clock_out: "low",
  // Reads (default)
  search_menu: "low",
  get_order: "low",
  // General assistant — email
  list_inbox: "low",
  search_email: "low",
  read_email: "low",
  mark_email_read: "low",
  create_email_draft: "low",
  send_email: "medium",
  archive_email: "medium",
  trash_email: "high",
  // General assistant — knowledge / web / db
  search_knowledge: "low",
  list_knowledge: "low",
  web_search: "low",
  fetch_url: "low",
  query_database: "low",
  list_database_connections: "low",
};

export function getToolRisk(toolName: string): ToolRiskLevel {
  return TOOL_RISK_DEFAULTS[toolName] ?? "medium";
}
