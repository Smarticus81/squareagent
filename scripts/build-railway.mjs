import { spawnSync } from "node:child_process";

const steps = [
  {
    command: "pnpm",
    args: ["run", "typecheck:libs"],
  },
  {
    command: "pnpm",
    args: ["--dir", "artifacts/api-server", "run", "typecheck"],
  },
  {
    command: "pnpm",
    args: ["--dir", "artifacts/bevpro-landing", "run", "typecheck"],
  },
  {
    command: "pnpm",
    args: ["--dir", "artifacts/voice-agent-pwa", "exec", "tsc", "--noEmit", "-p", "tsconfig.json"],
  },
  {
    command: "pnpm",
    args: ["--dir", "artifacts/bevpro-landing", "run", "build"],
  },
  {
    command: "pnpm",
    args: ["--dir", "artifacts/voice-agent-pwa", "run", "build"],
    env: { BASE_PATH: "/agent/" },
  },
  {
    command: "pnpm",
    args: ["--dir", "artifacts/api-server", "run", "build"],
  },
];

for (const step of steps) {
  const result = spawnSync(step.command, step.args, {
    stdio: "inherit",
    shell: true,
    env: {
      ...process.env,
      ...step.env,
    },
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}