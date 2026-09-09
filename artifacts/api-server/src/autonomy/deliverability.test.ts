import { describe, expect, it } from "vitest";
import { isAutomatedSystemMessage } from "./deliverability";

describe("outbound deliverability guardrails", () => {
  it("recognizes provider delivery-status notices as automated", () => {
    expect(isAutomatedSystemMessage({
      from: "Mail Delivery Subsystem <mailer-daemon@googlemail.com>",
      subject: "Delivery Status Notification (Failure)",
      autoSubmitted: "auto-replied",
      returnPath: "<>",
    })).toBe(true);
  });

  it("recognizes Microsoft postmaster and GitHub notification mail", () => {
    expect(isAutomatedSystemMessage({ from: "postmaster@microsoft.com", subject: "Undeliverable: message" })).toBe(true);
    expect(isAutomatedSystemMessage({ from: "notifications@github.com", subject: "Pull request update" })).toBe(true);
  });

  it("recognizes no-reply and out-of-office messages", () => {
    expect(isAutomatedSystemMessage({ from: "no-reply@example.org", subject: "Receipt" })).toBe(true);
    expect(isAutomatedSystemMessage({ from: "owner@venue.com", subject: "Out of office" })).toBe(true);
  });

  it("does not classify a normal business reply as automated", () => {
    expect(isAutomatedSystemMessage({
      from: "events@realvenue.com",
      subject: "Re: Less tapping behind the bar",
      autoSubmitted: "no",
      returnPath: "<events@realvenue.com>",
    })).toBe(false);
  });
});
