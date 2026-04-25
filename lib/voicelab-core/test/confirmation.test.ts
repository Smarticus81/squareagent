import { describe, it, expect } from "vitest";
import {
  DEFAULT_CONFIRMATION_POLICY,
  getToolRisk,
  requiresConfirmation,
} from "../src/confirmation/types";

describe("confirmation policy", () => {
  it("always confirms submit_order regardless of mode", () => {
    expect(requiresConfirmation("submit_order", "destructive", "quiet_room")).toBe(true);
    expect(requiresConfirmation("submit_order", "destructive", "manual_push_to_talk")).toBe(true);
  });

  it("never confirms read-only tools regardless of mode", () => {
    expect(requiresConfirmation("search_menu", "low", "nightclub")).toBe(false);
    expect(requiresConfirmation("get_order", "low", "bar")).toBe(false);
  });

  it("requires confirmation in nightclub mode at low risk", () => {
    expect(requiresConfirmation("add_item", "low", "nightclub")).toBe(true);
  });

  it("does not require confirmation for medium risk in quiet room", () => {
    // quiet_room threshold = high → medium does NOT require
    expect(requiresConfirmation("update_customer", "medium", "quiet_room")).toBe(false);
  });

  it("requires confirmation for high risk in restaurant mode", () => {
    // restaurant threshold = medium → high DOES require
    expect(requiresConfirmation("create_item", "high", "restaurant")).toBe(true);
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
