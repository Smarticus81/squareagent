/**
 * Workflow types — multi-step automated tool sequences.
 */

import type { ToolResult } from "../tools/types";

export interface WorkflowStep {
  /** Tool to execute. */
  toolName: string;
  /** Static args or a function that builds args from previous results. */
  args: Record<string, unknown> | ((previousResults: StepResult[]) => Record<string, unknown>);
  /** Human-readable step description (shown in workflow output). */
  label: string;
  /** If true, continue workflow even if this step fails. Default: true. */
  continueOnError?: boolean;
}

export interface WorkflowDefinition {
  /** Unique workflow identifier. */
  id: string;
  /** Human-readable name. */
  name: string;
  /** Description for the OpenAI tool definition. */
  description: string;
  /** Ordered steps to execute. */
  steps: WorkflowStep[];
  /** Optional parameters the user can provide when invoking the workflow. */
  parameters?: Record<string, { type: string; description: string; default?: unknown }>;
}

export interface StepResult {
  step: string;
  result: string;
  durationMs: number;
  ok: boolean;
}

export interface WorkflowResult {
  /** Formatted summary of all step results (returned to AI agent). */
  result: string;
  /** Individual step results for detailed inspection. */
  stepResults: StepResult[];
  /** Total duration of the workflow. */
  totalDurationMs: number;
}
