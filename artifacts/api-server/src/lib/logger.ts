import pino from "pino";

const level = process.env.LOG_LEVEL ?? (process.env.NODE_ENV === "production" ? "info" : "debug");

export const logger = pino({
  level,
  transport: process.env.NODE_ENV !== "production" ? { target: "pino/file", options: { destination: 1 } } : undefined,
});

export function createComponentLogger(component: string) {
  return logger.child({ component });
}
