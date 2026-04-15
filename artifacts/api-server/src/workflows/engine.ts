/**
 * Workflow Engine — executes multi-step tool sequences.
 *
 * Each step calls an existing tool via executeToolCall.
 * Steps run sequentially, with results from previous steps available
 * to build args for later steps.
 */

import type { ToolContext } from "../tools/types";
import { executeToolCall } from "../tools";
import type { WorkflowDefinition, StepResult, WorkflowResult } from "./types";

/**
 * Execute a workflow by running each step sequentially through the tool registry.
 */
export async function executeWorkflow(
  workflow: WorkflowDefinition,
  userArgs: Record<string, unknown>,
  ctx: ToolContext,
): Promise<WorkflowResult> {
  const stepResults: StepResult[] = [];
  const totalStart = Date.now();

  for (const step of workflow.steps) {
    const stepStart = Date.now();
    const continueOnError = step.continueOnError !== false; // default true

    // Build args: static object or dynamic function
    let args: Record<string, unknown>;
    if (typeof step.args === "function") {
      args = step.args(stepResults);
    } else {
      // Merge static args with any user-provided overrides
      args = { ...step.args, ...userArgs };
    }

    try {
      const { result } = await executeToolCall(step.toolName, args, ctx);
      stepResults.push({
        step: step.label,
        result,
        durationMs: Date.now() - stepStart,
        ok: true,
      });
    } catch (e: any) {
      const errorResult: StepResult = {
        step: step.label,
        result: `Error: ${e.message}`,
        durationMs: Date.now() - stepStart,
        ok: false,
      };
      stepResults.push(errorResult);

      if (!continueOnError) {
        break;
      }
    }
  }

  const totalDurationMs = Date.now() - totalStart;

  // Format results into a readable summary
  const resultLines = stepResults.map((sr) => {
    const status = sr.ok ? "✓" : "✗";
    return `${status} ${sr.step}:\n${sr.result}`;
  });

  return {
    result: `Workflow: ${workflow.name}\n\n${resultLines.join("\n\n")}`,
    stepResults,
    totalDurationMs,
  };
}
