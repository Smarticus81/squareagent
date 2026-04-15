/**
 * Orders & Reporting Skill — order history, sales reports, analytics.
 */

import type { SkillDefinition } from "./types";
import { definitions as orderDefs, executors as orderExecs } from "../tools/orders";
import { definitions as reportDefs, executors as reportExecs } from "../tools/reports";
import { definitions as locationDefs, executors as locationExecs } from "../tools/locations";

const ordersReportingSkill: SkillDefinition = {
  id: "orders-reporting",
  name: "Orders & Reporting",
  description: "Order history, sales reports, hourly breakdowns, item performance, daily summaries",
  tools: [...orderDefs, ...reportDefs, ...locationDefs],
  executors: { ...orderExecs, ...reportExecs, ...locationExecs },
  instructions: `Reports & Orders:
- Sales reports: today, yesterday, this week, last 7 days, this month.
- Present numbers naturally: "you did forty-two orders, twelve hundred in revenue."
- Top sellers, hourly breakdowns, item performance, daily summaries available.
- Lead with the headline: "Good shift — 47 orders, eighteen hundred revenue."
- You can list open orders on the POS and get full order details by ID.`,
  requiredContext: ["squareToken", "squareLocationId"],
  tier: "core",
};

export default ordersReportingSkill;
