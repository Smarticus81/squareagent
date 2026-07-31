/**
 * Opening Checklist workflow — inventory overview → low stock → team status → locations.
 */

import type { WorkflowDefinition } from "../types";

const openingChecklist: WorkflowDefinition = {
  id: "opening_checklist",
  name: "Opening Checklist",
  description: "Run your opening checklist: check overall inventory health, flag items that need restocking, see who's working, and verify locations are active.",
  steps: [
    {
      toolName: "inventory_summary",
      args: {},
      label: "Inventory Overview",
    },
    {
      toolName: "low_stock_report",
      args: { threshold: 10 },
      label: "Restock Alerts (threshold: 10)",
    },
    {
      toolName: "current_shifts",
      args: {},
      label: "Who's Working",
    },
    {
      toolName: "list_locations",
      args: {},
      label: "Active Locations",
    },
  ],
};

export default openingChecklist;
