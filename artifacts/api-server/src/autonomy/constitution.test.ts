import { describe, expect, it } from "vitest";
import { authorityForAction, VOYCELAB_OBJECTIVE } from "./constitution";

describe("VoyceLab autonomy constitution", () => {
  it("keeps routine growth actions autonomous", () => {
    expect(authorityForAction("outreach.email", "medium")).toBe("autonomous");
    expect(authorityForAction("ads.adjust_budget", "medium")).toBe("autonomous");
  });

  it("requires canary gating for ordinary code changes", () => {
    expect(authorityForAction("code.product_fix", "medium")).toBe("canary");
    expect(authorityForAction("code.copy_change", "low")).toBe("canary");
  });

  it("requires founder authority for critical or protected changes", () => {
    expect(authorityForAction("code.product_fix", "critical")).toBe("founder");
    expect(authorityForAction("auth.change_session_policy", "low")).toBe("founder");
    expect(authorityForAction("database.destructive_migration", "medium")).toBe("founder");
    expect(authorityForAction("constitution.change_objective", "low")).toBe("founder");
  });

  it("forbids disabling safety or exposing secrets", () => {
    expect(authorityForAction("security.disable_middleware", "low")).toBe("forbidden");
    expect(authorityForAction("audit.disable", "low")).toBe("forbidden");
    expect(authorityForAction("secrets.expose_customer_token", "low")).toBe("forbidden");
    expect(authorityForAction("spam.ignore_opt_out", "low")).toBe("forbidden");
  });

  it("contains immutable customer-trust constraints", () => {
    expect(VOYCELAB_OBJECTIVE.hardConstraints.join(" ")).toMatch(/opt-out/i);
    expect(VOYCELAB_OBJECTIVE.hardConstraints.join(" ")).toMatch(/secrets/i);
    expect(VOYCELAB_OBJECTIVE.hardConstraints.join(" ")).toMatch(/constitution/i);
  });
});
