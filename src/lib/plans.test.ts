import { describe, it, expect } from "vitest";
import {
  FREE_MODEL_CAP,
  canCreate,
  countFreeModels,
  friendlyError,
  planErrorMessage,
  quotaState,
  PLAN_COPY,
} from "./plans";

describe("plans", () => {
  it("counts only tabletop/wall toward the free cap", () => {
    expect(
      countFreeModels([{ mode: "tabletop" }, { mode: "wall" }, { mode: "multipoint" }, { mode: null }]),
    ).toBe(2);
  });

  it("reports quota for free and paid plans", () => {
    expect(quotaState("free", 2)).toEqual({ used: 2, cap: FREE_MODEL_CAP, remaining: 1, reached: false });
    expect(quotaState("free", FREE_MODEL_CAP).reached).toBe(true);
    expect(quotaState("free", FREE_MODEL_CAP + 2).remaining).toBe(0);
    expect(quotaState("paid", 10)).toMatchObject({ remaining: null, reached: false });
  });

  it("mirrors the database rules for creating projects", () => {
    expect(canCreate("tabletop", "free", FREE_MODEL_CAP - 1)).toBe(true);
    expect(canCreate("wall", "free", FREE_MODEL_CAP)).toBe(false);
    expect(canCreate("multipoint", "free", 0)).toBe(false);
    expect(canCreate("multipoint", "paid", 99)).toBe(true);
    expect(canCreate("tabletop", "paid", 99)).toBe(true);
  });

  it("maps trigger errors to friendly copy", () => {
    expect(planErrorMessage({ message: "FREE_MODEL_CAP_REACHED: free plan allows 3 Tabletop/Wall models" }))
      .toBe(PLAN_COPY.capReached);
    expect(planErrorMessage({ message: "SPATIAL_REQUIRES_PAID: Spatial experiences are part of the paid plan" }))
      .toBe(PLAN_COPY.spatialLocked);
    expect(planErrorMessage("ENTITLEMENT_READ_ONLY: paid_at can only be set by Archi AR"))
      .toBe(PLAN_COPY.entitlementReadOnly);
    expect(planErrorMessage({ message: "duplicate key" })).toBeNull();
  });

  it("falls back to the raw message, then a generic one", () => {
    expect(friendlyError({ message: "Network down" })).toBe("Network down");
    expect(friendlyError(null, "Oops")).toBe("Oops");
  });
});
