/**
 * Centralized error sanitization — stable codes to clients, full detail in logs.
 */

import type { Response } from "express";
import { createComponentLogger } from "./logger";

const log = createComponentLogger("errors");

export function sanitizeErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return "Unknown error";
}

export function sendSanitizedError(
  res: Response,
  status: number,
  code: string,
  err?: unknown,
  detail?: string,
): void {
  if (err) {
    log.error({ code, status, err: sanitizeErrorMessage(err) }, "request error");
  }
  res.status(status).json({
    error: code,
    code,
    ...(detail ? { detail } : {}),
  });
}

export function toolErrorResult(code: string): string {
  return JSON.stringify({ status: "error", code, message: "Command failed. Please try again." });
}
