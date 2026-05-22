/**
 * General Assistant Skill — bundles web/knowledge/email/database tools that
 * power the non-venue, "general business assistant" mode. Loaded only when
 * the realtime session asks for assistantKind === "general".
 *
 * Tier is `core` so every paid plan (and trial) gets it; gating is done at
 * the kind level, not the plan level.
 */

import type { SkillDefinition } from "./types";
import * as web from "../tools/general/web";
import * as knowledge from "../tools/general/knowledge";
import * as email from "../tools/general/email";
import * as emailRead from "../tools/general/email-read";
import * as database from "../tools/general/database";

const generalAssistantSkill: SkillDefinition = {
  id: "general-assistant",
  name: "General Assistant",
  description: "Web search, knowledge base, email (Gmail read+send), and database access for the non-venue assistant.",
  tools: [
    ...web.definitions,
    ...knowledge.definitions,
    ...email.definitions,
    ...emailRead.definitions,
    ...database.definitions,
  ],
  executors: {
    ...web.executors,
    ...knowledge.executors,
    ...email.executors,
    ...emailRead.executors,
    ...database.executors,
  },
  instructions: `Available capabilities:
- Knowledge: \`search_knowledge\` to look up the user's uploaded notes/SOPs/FAQs, \`list_knowledge\` to see what's there. Prefer this BEFORE \`web_search\` for anything business-specific.
- Web: \`web_search\` for live facts and \`fetch_url\` to read a specific page.
- Email (read): if Gmail is connected via OAuth in Data sources, triage the inbox by voice. Call read tools immediately — never ask the user for permission first.
  - \`list_inbox\` shows recent messages (default in:inbox). Use Gmail search syntax: 'is:unread', 'from:sarah newer_than:2d', 'subject:invoice has:attachment'.
  - \`search_email\` for arbitrary searches across all mail (uses the same syntax).
  - \`read_email\` fetches the full body of a specific message (use the id from list_inbox).
  - \`archive_email\`, \`mark_email_read\`, \`trash_email\` manage messages — ALWAYS confirm out loud before trashing.
  - \`create_email_draft\` composes a draft without sending.
- Email (send): \`send_email\` sends from the user's configured outbound address. Always confirm recipient + subject + 1-line body summary out loud first. Never send blind.
- Database: \`query_database\` runs read-only SELECTs against the user's connected Postgres. List columns by name, never SELECT *. Use \`list_database_connections\` if unsure which DB.

Tool etiquette:
- If a tool fails or a connection isn't configured, say so plainly in one sentence — don't pretend the action happened.
- For multi-step requests (e.g. "look this up and email it to Sarah"), execute the steps quietly and report only the final outcome.
- When summarizing the inbox, lead with unread + urgent items, then group the rest by sender or topic. Be brief.`,
  requiredContext: [],
  tier: "core",
};

export default generalAssistantSkill;
