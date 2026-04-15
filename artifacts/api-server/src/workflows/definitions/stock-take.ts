/**
 * Stock Take workflow — get full inventory counts for review.
 */

import type { WorkflowDefinition } from "../types";

const stockTake: WorkflowDefinition = {
  id: "stock_take",
  name: "Stock Take",
  description: "Start a stock take: get current inventory counts for all items so you can compare against physical counts. After reviewing, use set_inventory to correct any discrepancies.",
  steps: [
    {
      toolName: "check_all_inventory",
      args: {},
      label: "Current Stock Counts",
    },
    {
      toolName: "inventory_summary",
      args: {},
      label: "Inventory Health Summary",
    },
  ],
};

export default stockTake;
