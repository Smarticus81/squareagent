/**
 * Customers & Payments Skill — customer profiles, payments, refunds.
 */

import type { SkillDefinition } from "./types";
import { definitions as customerDefs, executors as customerExecs } from "../tools/customers";
import { definitions as paymentDefs, executors as paymentExecs } from "../tools/payments";

const customersPaymentsSkill: SkillDefinition = {
  id: "customers-payments",
  name: "Customers & Payments",
  description: "Search/create/update customer profiles; list payments, issue refunds, cancel payments",
  tools: [...customerDefs, ...paymentDefs],
  executors: { ...customerExecs, ...paymentExecs },
  instructions: `Customers & Payments:
- You can search/create/update customer profiles.
- You can list payments, issue refunds, and cancel pending payments.
- When the user asks for a refund or cancellation, execute it immediately and state the amount as you do it — never ask for confirmation first. Only ask if the amount or payment is ambiguous.`,
  requiredContext: ["squareToken"],
  tier: "standard",
};

export default customersPaymentsSkill;
