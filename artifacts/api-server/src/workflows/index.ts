/**
 * Workflow Registry — converts workflow definitions into tool definitions
 * so they appear as callable tools to the AI agent.
 */

import type { ToolDefinition, ToolExecutor } from "../tools/types";
import type { WorkflowDefinition } from "./types";
import { executeWorkflow } from "./engine";

import endOfDay from "./definitions/end-of-day";
import openingChecklist from "./definitions/opening-checklist";
import stockTake from "./definitions/stock-take";

// ── All registered workflows ────────────────────────────────────────────────

export const ALL_WORKFLOWS: WorkflowDefinition[] = [
  endOfDay,
  openingChecklist,
  stockTake,
];

// ── Convert workflows to tool definitions ───────────────────────────────────

function workflowToToolDefinition(wf: WorkflowDefinition): ToolDefinition {
  const properties: Record<string, { type: string; description: string }> = {};

  if (wf.parameters) {
    for (const [key, param] of Object.entries(wf.parameters)) {
      properties[key] = { type: param.type, description: param.description };
    }
  }

  return {
    type: "function",
    name: wf.id,
    description: wf.description,
    parameters: {
      type: "object",
      properties,
    },
  };
}

function workflowToExecutor(wf: WorkflowDefinition): ToolExecutor {
  return async (args, ctx) => {
    const { result } = await executeWorkflow(wf, args, ctx);
    return { result };
  };
}

// ── Exports for tool registry integration ───────────────────────────────────

/** Tool definitions generated from all workflows. */
export const definitions: ToolDefinition[] = ALL_WORKFLOWS.map(workflowToToolDefinition);

/** Executor map generated from all workflows. */
export const executors: Record<string, ToolExecutor> = {};
for (const wf of ALL_WORKFLOWS) {
  executors[wf.id] = workflowToExecutor(wf);
}
