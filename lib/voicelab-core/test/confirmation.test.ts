import { describe, it, expect } from "vitest";
import {
  DEFAULT_CONFIRMATION_POLICY,
  getToolRisk,
  requiresConfirmation,
  type ConfirmationPolicy,
} from "../src/confirmation/types";

describe("confirmation policy", () => {
  it("executes submit_order immediately in every mode (user command is the confirmation)", () => {
    expect(requiresConfirmation("submit_order", "destructive", "standard")).toBe(false);
    expect(requiresConfirmation("submit_order", "destructive", "loud")).toBe(false);
    expect(requiresConfirmation("submit_order", "destructive", "push_to_talk")).toBe(false);
  });

  it("executes send_to_terminal immediately in every mode", () => {
    expect(requiresConfirmation("send_to_terminal", "destructive", "standard")).toBe(false);
    expect(requiresConfirmation("send_to_terminal", "destructive", "push_to_talk")).toBe(false);
  });

  it("never confirms read-only tools regardless of mode", () => {
    expect(requiresConfirmation("search_menu", "low", "push_to_talk")).toBe(false);
    expect(requiresConfirmation("get_order", "low", "loud")).toBe(false);
  });

  it("does not require confirmation for any risk level by default", () => {
    expect(requiresConfirmation("add_item", "low", "standard")).toBe(false);
    expect(requiresConfirmation("create_item", "high", "standard")).toBe(false);
    expect(requiresConfirmation("refund_payment", "destructive", "push_to_talk")).toBe(false);
  });

  it("default policy has no always-confirm tools", () => {
    expect(DEFAULT_CONFIRMATION_POLICY.alwaysConfirm).toEqual([]);
  });

  it("still classifies tool risk for telemetry and custom policies", () => {
    expect(getToolRisk("submit_order")).toBe("destructive");
    expect(getToolRisk("delete_item")).toBe("destructive");
    expect(getToolRisk("refund_payment")).toBe("destructive");
    expect(getToolRisk("add_item")).toBe("low");
  });

  it("honors a custom policy that re-enables confirmation", () => {
    const strictPolicy: ConfirmationPolicy = {
      alwaysConfirm: ["submit_order"],
      neverConfirm: ["search_menu"],
      thresholdByNoiseMode: {
        standard: "medium",
        loud: "medium",
        push_to_talk: "low",
      },
    };
    expect(requiresConfirmation("submit_order", "destructive", "standard", strictPolicy)).toBe(true);
    expect(requiresConfirmation("search_menu", "low", "push_to_talk", strictPolicy)).toBe(false);
    expect(requiresConfirmation("create_item", "high", "standard", strictPolicy)).toBe(true);
    expect(requiresConfirmation("add_item", "low", "standard", strictPolicy)).toBe(false);
  });
});
