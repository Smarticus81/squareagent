/**
 * End of Day Close workflow — daily summary → open orders → low stock report.
 */

import type { WorkflowDefinition } from "../types";

const endOfDay: WorkflowDefinition = {
  id: "end_of_day_close",
  name: "End of Day Close",
  description: "Run your end-of-day routine: get today's sales summary, check for open orders that need closing, and flag low stock items.",
  steps: [
    {
      toolName: "daily_summary",
      args: {},
      label: "Daily Sales Summary",
    },
    {
      toolName: "list_open_orders",
      args: {},
      label: "Open Orders Check",
    },
    {
      toolName: "low_stock_report",
      args: { threshold: 5 },
      label: "Low Stock Report",
    },
  ],
};

export default endOfDay;
