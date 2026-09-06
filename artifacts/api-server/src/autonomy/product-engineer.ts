import { pool } from "@workspace/db";
import { codeWritesEnabled } from "./constitution";
import { structuredModel } from "./openai";
import {
  createAutonomyBranch,
  listRepositoryFiles,
  openPullRequest,
  readRepositoryFile,
  repositoryConfig,
  writeRepositoryFile,
} from "./github";
import { markActionExecuted, markActionFailed, recordAutonomousAction } from "./ledger";

export interface ProductFinding {
  id?: string;
  fingerprint: string;
  severity: "low" | "medium" | "high" | "critical";
  subsystem: string;
  title: string;
  evidence: unknown[];
  recommendedChange?: Record<string, unknown>;
}

const PATH_SELECTION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["paths", "reasoning"],
  properties: {
    paths: { type: "array", minItems: 1, maxItems: 6, items: { type: "string" } },
    reasoning: { type: "string" },
  },
} as const;

const PATCH_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "summary", "files", "successMetric", "rollbackCriterion"],
  properties: {
    title: { type: "string" },
    summary: { type: "string" },
    successMetric: { type: "string" },
    rollbackCriterion: { type: "string" },
    files: {
      type: "array",
      minItems: 1,
      maxItems: 4,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["path", "content", "rationale"],
        properties: {
          path: { type: "string" },
          content: { type: "string" },
          rationale: { type: "string" },
        },
      },
    },
  },
} as const;

const PROTECTED_PATH_PATTERNS = [
  /(^|\/)secrets\.ts$/i,
  /(^|\/)auth\.ts$/i,
  /subscriptions\.ts$/i,
  /autonomy\/constitution\.ts$/i,
  /lib\/db\/src\/schema/i,
  /lib\/db\/src\/autonomy-schema\.ts$/i,
  /\.env/i,
  /pnpm-lock\.yaml$/i,
  /package-lock\.json$/i,
];

function protectedPath(path: string): boolean {
  return PROTECTED_PATH_PATTERNS.some((pattern) => pattern.test(path));
}

function candidateSourcePath(path: string): boolean {
  return /\.(ts|tsx|js|jsx|json|md)$/i.test(path)
    && !protectedPath(path)
    && !/(^|\/)(branding|artifacts\/.*\/dist)(\/|$)/i.test(path);
}

export async function generateProductRepair(
  finding: ProductFinding,
  runId?: string,
): Promise<{ prUrl?: string; branch?: string; blocked?: string }> {
  const action = await recordAutonomousAction({
    runId,
    agent: "product-engineer",
    actionType: "code.product_fix",
    riskLevel: finding.severity === "critical" ? "critical" : finding.severity === "high" ? "high" : "medium",
    input: finding,
    expectedImpact: { finding: finding.fingerprint, objective: "reduce failures and improve successful activation" },
  });

  if (action.authority === "founder" || action.authority === "forbidden") {
    return { blocked: action.authority };
  }
  if (!codeWritesEnabled()) {
    await markActionFailed(action.id, { reason: "AUTONOMY_ENABLE_CODE_WRITES is disabled" });
    return { blocked: "code_writes_disabled" };
  }

  try {
    const allFiles = (await listRepositoryFiles()).filter(candidateSourcePath);
    const pathSelection = await structuredModel<{ paths: string[]; reasoning: string }>(
      [
        "You are the repository triage worker for VoyceLab.",
        "Choose the smallest set of existing source/test files needed to diagnose and repair the supplied production finding.",
        "Prefer files in the implicated subsystem plus an existing nearby test. Do not choose auth, secrets, billing/subscription, database schema, environment files, lockfiles, generated artifacts, or the autonomy constitution.",
        "Choose at most six paths and only paths present in the supplied repository list.",
      ].join("\n"),
      { finding, repository: repositoryConfig(), files: allFiles.slice(0, 900) },
      { schemaName: "voycelab_repo_path_selection", schema: PATH_SELECTION_SCHEMA as unknown as Record<string, unknown>, reasoningEffort: "medium", maxOutputTokens: 1200 },
    );

    const chosen = pathSelection.paths.filter((path) => allFiles.includes(path) && !protectedPath(path)).slice(0, 6);
    if (!chosen.length) throw new Error("Product engineer did not select any safe repository files");

    const fileContext: Array<{ path: string; content: string }> = [];
    for (const path of chosen) {
      const file = await readRepositoryFile(path);
      // Keep a single repair run bounded. Oversized files remain inspectable in
      // a later targeted run, but are not rewritten wholesale by this worker.
      if (file.content.length <= 45_000) fileContext.push({ path, content: file.content });
    }
    if (!fileContext.length) throw new Error("Selected files exceed safe autonomous rewrite size");

    const repair = await structuredModel<{
      title: string;
      summary: string;
      successMetric: string;
      rollbackCriterion: string;
      files: Array<{ path: string; content: string; rationale: string }>;
    }>(
      [
        "You are VoyceLab's production product-engineering worker.",
        "Repair the observed product problem with the smallest safe change. Return COMPLETE replacement contents only for files that must change.",
        "Preserve existing architecture and public behavior except where the finding requires correction. Add or update a focused regression test when a suitable test file is in context.",
        "Do not modify files not supplied in context. Do not weaken auth, permissions, confirmations, encryption, billing, audit logging, rate limits, or secret handling.",
        "Do not add new dependencies unless absolutely necessary. Never place credentials or secret values in code.",
        "The change must have an explicit production success metric and rollback criterion.",
      ].join("\n"),
      { finding, files: fileContext },
      { schemaName: "voycelab_product_repair", schema: PATCH_SCHEMA as unknown as Record<string, unknown>, reasoningEffort: "high", maxOutputTokens: 18_000 },
    );

    const allowed = new Set(fileContext.map((file) => file.path));
    const changed = repair.files.filter((file) => allowed.has(file.path) && !protectedPath(file.path));
    if (!changed.length) throw new Error("Generated repair attempted no allowed file changes");

    const { branch } = await createAutonomyBranch(finding.subsystem || "product-fix");
    for (const file of changed) {
      await writeRepositoryFile({
        branch,
        path: file.path,
        content: file.content,
        message: `fix(autonomy): ${repair.title}`,
      });
    }

    const pr = await openPullRequest({
      branch,
      title: `[Autonomy] ${repair.title}`,
      body: [
        "## Autonomous product repair",
        "",
        repair.summary,
        "",
        `**Finding:** ${finding.title}`,
        `**Fingerprint:** \`${finding.fingerprint}\``,
        `**Success metric:** ${repair.successMetric}`,
        `**Rollback criterion:** ${repair.rollbackCriterion}`,
        "",
        "### Safety boundary",
        "This PR was generated from production telemetry. Protected auth, secret, billing, database-schema, lockfile, and constitution paths are excluded from autonomous repair.",
        "Merge should occur only after repository checks/evals succeed.",
      ].join("\n"),
    });

    if (pool && finding.id) {
      await pool.query(
        `UPDATE product_findings SET github_pr_url=$2, status='repair_proposed', updated_at=now() WHERE id=$1`,
        [finding.id, pr.url],
      );
    }
    await markActionExecuted(action.id, { branch, prNumber: pr.number, files: changed.map((file) => file.path), successMetric: repair.successMetric, rollbackCriterion: repair.rollbackCriterion }, pr.url);
    return { prUrl: pr.url, branch };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await markActionFailed(action.id, { error: message });
    throw error;
  }
}
