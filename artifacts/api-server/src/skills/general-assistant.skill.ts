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

Gmail — full inbox access (read, search, manage, draft, send):
  Tools: \`list_inbox\`, \`search_email\`, \`read_email\`, \`archive_email\`, \`mark_email_read\`, \`trash_email\`, \`create_email_draft\`, \`send_email\`.
  - \`list_inbox\`: List recent emails. Params: query (Gmail search syntax, default "in:inbox"), max_results (1-25, default 10).
    Search syntax examples: "is:unread", "from:sarah newer_than:2d", "subject:invoice has:attachment", "from:supplier@drinks.com", "label:urgent", "in:sent newer_than:1d", "to:me is:unread category:primary".
  - \`search_email\`: Search across ALL mail (sent, archived, trash). Same syntax. Params: query (required), max_results (1-25).
  - \`read_email\`: Fetch the full body of a message. Params: id (from list_inbox/search_email results). Returns from, to, cc, subject, date, body, labels.
  - \`archive_email\`: Remove from INBOX label. Params: id. Call immediately when the user asks to archive or for triage.
  - \`mark_email_read\`: Remove UNREAD label. Params: id. Safe to call without confirmation.
  - \`trash_email\`: Move to Trash. Params: id. Call immediately when the user asks — their instruction is the confirmation.
  - \`create_email_draft\`: Create a Gmail draft (does NOT send). Params: to, subject, body (all required), cc (optional). Use when user says "draft" or "prepare" but doesn't want to send yet.
  - \`send_email\`: Send from the user's configured address. Params: to, subject, body (required), cc (optional). When the user asks to send, send immediately — don't ask for confirmation first; state what was sent afterward.

  Gmail behavior rules:
  - When user says "check my email" or "what's new" → call \`list_inbox\` with query "is:unread" immediately. No preamble, no asking.
  - When summarizing: state unread count first, then highlight urgent/flagged, then group rest by sender or topic. Keep it concise — never read full bodies unless asked.
  - When user asks about a specific email → use \`read_email\` to get the full body, then summarize the key points.
  - When user says "reply to that" → use \`send_email\` (or \`create_email_draft\` if they say "draft"). Use context from the previous \`read_email\` for the recipient and subject (prepend "Re: ").
  - When user says "forward that to X" → use \`send_email\` with the body from \`read_email\` and the new recipient.
  - Batch operations: if user says "archive all from [sender]" → list, then archive each. Report count when done.

Knowledge base — uploaded venue documents:
  Tools: \`search_knowledge\`, \`list_knowledge\`.
  - \`search_knowledge\`: Semantic search over user's docs (SOPs, menus, contracts, handbooks, recipes, event briefs). Params: query (required), top_k (1-8, default 4). ALWAYS prefer this over web_search for business-specific questions.
  - \`list_knowledge\`: Show all uploaded documents with titles and chunk counts. No params.

Web — live internet search:
  Tools: \`web_search\`, \`fetch_url\`.
  - \`web_search\`: Search the open web. Params: query (required), max_results (1-10, default 5). Use for supplier info, regulations, competitor research, product specs, licensing.
  - \`fetch_url\`: Read a specific webpage. Params: url (required). Use when user shares a link or you need details from a search result.

Database — connected Postgres:
  Tools: \`query_database\`, \`list_database_connections\`.
  - \`query_database\`: Read-only SELECT queries. Params: sql (required), connection_label (optional). Name columns explicitly — never SELECT *. Max 100 rows returned.
  - \`list_database_connections\`: List available DB connections with labels and schema hints.

Tool etiquette:
- If a tool fails or a connection isn't configured, say so plainly in one sentence — don't pretend the action happened.
- For multi-step requests (e.g. "find that invoice and email it to Sarah"), execute steps quietly and report only the final outcome.
- Always prefer knowledge base over web search for anything the user may have uploaded.
- Never invent tool results. If you don't have data, say so.`,
  requiredContext: [],
  tier: "core",
};

export default generalAssistantSkill;
