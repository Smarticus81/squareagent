import { describe, it, expect } from "vitest";
import {
  DEFAULT_CONFIRMATION_POLICY,
  getToolRisk,
  requiresConfirmation,
} from "../src/confirmation/types";

describe("confirmation policy", () => {
  it("always confirms submit_order regardless of mode", () => {
    expect(requiresConfirmation("submit_order", "destructive", "standard")).toBe(true);
    expect(requiresConfirmation("submit_order", "destructive", "push_to_talk")).toBe(true);
  });

  it("never confirms read-only tools regardless of mode", () => {
    expect(requiresConfirmation("search_menu", "low", "push_to_talk")).toBe(false);
    expect(requiresConfirmation("get_order", "low", "loud")).toBe(false);
  });

  it("requires confirmation in push_to_talk mode at low risk", () => {
    expect(requiresConfirmation("add_item", "low", "push_to_talk")).toBe(true);
  });

  it("does not require confirmation for low risk in standard mode", () => {
    // standard threshold = medium → low does NOT require
    expect(requiresConfirmation("add_item", "low", "standard")).toBe(false);
  });

  it("requires confirmation for high risk in standard mode", () => {
    // standard threshold = medium → high DOES require
    expect(requiresConfirmation("create_item", "high", "standard")).toBe(true);
  });

  it("classifies destructive tools by name", () => {
    expect(getToolRisk("submit_order")).toBe("destructive");
    expect(getToolRisk("delete_item")).toBe("destructive");
    expect(getToolRisk("refund_payment")).toBe("destructive");
    expect(getToolRisk("add_item")).toBe("low");
  });

  it("default policy contains the documented always-confirm tools", () => {
    expect(DEFAULT_CONFIRMATION_POLICY.alwaysConfirm).toContain("submit_order");
    expect(DEFAULT_CONFIRMATION_POLICY.alwaysConfirm).toContain("send_to_terminal");
    expect(DEFAULT_CONFIRMATION_POLICY.alwaysConfirm).toContain("refund_payment");
  });
});
