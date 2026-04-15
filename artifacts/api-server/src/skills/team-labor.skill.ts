/**
 * Team & Labor Skill — team members, shifts, clock in/out.
 */

import type { SkillDefinition } from "./types";
import { definitions, executors } from "../tools/team";

const teamLaborSkill: SkillDefinition = {
  id: "team-labor",
  name: "Team & Labor",
  description: "List team members, view current shifts, clock in/out",
  tools: definitions,
  executors,
  instructions: `Team & Shifts:
- You can list team members, see who's clocked in, clock people in/out.
- Present shift info naturally: "Jake's been on since two."`,
  requiredContext: ["squareToken", "squareLocationId"],
  tier: "premium",
};

export default teamLaborSkill;
