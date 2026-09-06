type GithubTreeEntry = { path?: string; type?: string; size?: number; sha?: string };

export interface GithubRepoConfig {
  repo: string;
  baseBranch: string;
}

function config(): GithubRepoConfig {
  return {
    repo: process.env.GITHUB_AUTONOMY_REPO?.trim() || "Smarticus81/squareagent",
    baseBranch: process.env.GITHUB_AUTONOMY_BASE_BRANCH?.trim() || "master",
  };
}

function token(): string {
  const value = process.env.GITHUB_AUTONOMY_TOKEN?.trim();
  if (!value) throw new Error("GITHUB_AUTONOMY_TOKEN is required for autonomous code changes");
  return value;
}

function apiUrl(path: string): string {
  const { repo } = config();
  return `https://api.github.com/repos/${repo}${path}`;
}

async function github<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(apiUrl(path), {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token()}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = (await res.text()).slice(0, 800);
    throw new Error(`GitHub autonomy request failed ${res.status} ${path}: ${body}`);
  }
  return (await res.json()) as T;
}

export async function getBaseCommitSha(): Promise<string> {
  const { baseBranch } = config();
  const ref = await github<{ object: { sha: string } }>(`/git/ref/heads/${encodeURIComponent(baseBranch)}`);
  return ref.object.sha;
}

export async function getCommit(commitSha: string): Promise<{ sha: string; treeSha: string; parents: string[] }> {
  const commit = await github<{ sha: string; tree: { sha: string }; parents: Array<{ sha: string }> }>(`/git/commits/${commitSha}`);
  return { sha: commit.sha, treeSha: commit.tree.sha, parents: (commit.parents ?? []).map((parent) => parent.sha) };
}

export async function listRepositoryFiles(): Promise<string[]> {
  const baseSha = await getBaseCommitSha();
  const commit = await getCommit(baseSha);
  const tree = await github<{ tree: GithubTreeEntry[]; truncated?: boolean }>(`/git/trees/${commit.treeSha}?recursive=1`);
  return (tree.tree ?? [])
    .filter((entry) => entry.type === "blob" && entry.path)
    .map((entry) => entry.path as string)
    .filter((path) => !/(^|\/)(node_modules|dist|build|coverage|\.git)(\/|$)/.test(path))
    .filter((path) => !/(pnpm-lock\.yaml|package-lock\.json|\.png$|\.jpg$|\.jpeg$|\.gif$|\.pdf$|\.mp4$)/i.test(path));
}

export async function readRepositoryFile(path: string, ref?: string): Promise<{ content: string; sha: string }> {
  const branch = ref ?? config().baseBranch;
  const data = await github<{ content: string; encoding: string; sha: string }>(
    `/contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(branch)}`,
  );
  if (data.encoding !== "base64") throw new Error(`Unsupported GitHub content encoding for ${path}`);
  return { content: Buffer.from(data.content.replace(/\n/g, ""), "base64").toString("utf8"), sha: data.sha };
}

export async function createAutonomyBranch(prefix: string): Promise<{ branch: string; baseSha: string }> {
  const baseSha = await getBaseCommitSha();
  const slug = prefix.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 42) || "change";
  const branch = `autonomy/${slug}-${Date.now().toString(36)}`;
  await github(`/git/refs`, {
    method: "POST",
    body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: baseSha }),
  });
  return { branch, baseSha };
}

export async function writeRepositoryFile(params: {
  branch: string;
  path: string;
  content: string;
  message: string;
}): Promise<string> {
  let existingSha: string | undefined;
  try {
    existingSha = (await readRepositoryFile(params.path, params.branch)).sha;
  } catch (error) {
    if (!String(error).includes("404")) throw error;
  }
  const result = await github<{ commit: { sha: string } }>(
    `/contents/${params.path.split("/").map(encodeURIComponent).join("/")}`,
    {
      method: "PUT",
      body: JSON.stringify({
        message: params.message,
        content: Buffer.from(params.content, "utf8").toString("base64"),
        branch: params.branch,
        ...(existingSha ? { sha: existingSha } : {}),
      }),
    },
  );
  return result.commit.sha;
}

export async function openPullRequest(params: {
  branch: string;
  title: string;
  body: string;
}): Promise<{ number: number; url: string; headSha: string }> {
  const { baseBranch } = config();
  const pr = await github<{ number: number; html_url: string; head: { sha: string } }>("/pulls", {
    method: "POST",
    body: JSON.stringify({
      title: params.title,
      head: params.branch,
      base: baseBranch,
      body: params.body,
      maintainer_can_modify: true,
    }),
  });
  return { number: pr.number, url: pr.html_url, headSha: pr.head.sha };
}

export async function getPullRequestGate(prNumber: number): Promise<{
  mergeable: boolean;
  checksPresent: boolean;
  checksSuccessful: boolean;
  headSha: string;
}> {
  const pr = await github<{ mergeable: boolean | null; head: { sha: string } }>(`/pulls/${prNumber}`);
  const headSha = pr.head.sha;
  const [status, checks] = await Promise.all([
    github<{ state: string; statuses: Array<{ state: string }> }>(`/commits/${headSha}/status`),
    github<{ total_count: number; check_runs: Array<{ status: string; conclusion: string | null }> }>(`/commits/${headSha}/check-runs`),
  ]);
  const statusItems = status.statuses ?? [];
  const checkItems = checks.check_runs ?? [];
  const checksPresent = statusItems.length + checkItems.length > 0;
  const statusesOk = statusItems.every((item) => item.state === "success");
  const runsOk = checkItems.every((item) => item.status === "completed" && ["success", "neutral", "skipped"].includes(item.conclusion ?? ""));
  return {
    mergeable: pr.mergeable === true,
    checksPresent,
    checksSuccessful: statusesOk && runsOk,
    headSha,
  };
}

export async function mergePullRequest(prNumber: number, headSha: string): Promise<{ merged: boolean; sha?: string; message?: string }> {
  return github(`/pulls/${prNumber}/merge`, {
    method: "PUT",
    body: JSON.stringify({ sha: headSha, merge_method: "squash" }),
  });
}

/**
 * Revert an autonomously merged commit only when it is still the current base
 * branch HEAD. This avoids clobbering unrelated work that landed afterwards.
 * The new revert commit points at the bad commit's first-parent tree and uses
 * the bad commit as its parent, producing a normal forward-moving revert.
 */
export async function revertHeadCommitIfUnchanged(badCommitSha: string, message: string): Promise<{ reverted: boolean; sha?: string; reason?: string }> {
  const currentHead = await getBaseCommitSha();
  if (currentHead !== badCommitSha) return { reverted: false, reason: "base_branch_advanced" };
  const bad = await getCommit(badCommitSha);
  const parentSha = bad.parents[0];
  if (!parentSha) return { reverted: false, reason: "no_parent_commit" };
  const parent = await getCommit(parentSha);
  const created = await github<{ sha: string }>("/git/commits", {
    method: "POST",
    body: JSON.stringify({ message, tree: parent.treeSha, parents: [badCommitSha] }),
  });
  const { baseBranch } = config();
  await github(`/git/refs/heads/${encodeURIComponent(baseBranch)}`, {
    method: "PATCH",
    body: JSON.stringify({ sha: created.sha, force: false }),
  });
  return { reverted: true, sha: created.sha };
}

export function repositoryConfig(): GithubRepoConfig {
  return config();
}
