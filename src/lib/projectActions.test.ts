import { describe, it, expect, vi } from "vitest";
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
import { copyName, restoredStatus, isArchived } from "./projectActions";

describe("project actions", () => {
  it("names copies without stacking suffixes", () => {
    expect(copyName("Office", [])).toBe("Office (copy)");
    expect(copyName("Office", ["Office (copy)"])).toBe("Office (copy 2)");
    expect(copyName("Office (copy)", ["Office (copy)", "Office (copy 2)"])).toBe("Office (copy 3)");
  });
  it("restores to active only when the experience was generated", () => {
    expect(restoredStatus({ mind_file_url: "p/targets.mind", share_link: "abc" })).toBe("active");
    expect(restoredStatus({ mind_file_url: null, share_link: "abc" })).toBe("draft");
    expect(restoredStatus({ mind_file_url: "p/targets.mind", share_link: null })).toBe("draft");
  });
  it("detects archived", () => {
    expect(isArchived({ status: "archived" })).toBe(true);
    expect(isArchived({ status: "active" })).toBe(false);
  });
});
