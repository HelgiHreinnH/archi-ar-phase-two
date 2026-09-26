/**
 * Free vs paid tiers (26 Sep 2026, migration 009).
 *
 * Free: Tabletop + Wall, at most FREE_MODEL_CAP of them per account.
 * Paid: Spatial (DB value `multipoint` — never renamed) and no cap.
 *
 * The database is the enforcer (`enforce_project_plan` trigger); everything
 * here only mirrors it so the UI can explain the limits before the user hits
 * them, and translate the trigger's errors into plain copy when they do.
 */

/** Mirrors `public.free_model_cap()` in migration 009. Change both together. */
export const FREE_MODEL_CAP = 3;

export type Plan = "free" | "paid";
export type ExperienceModeValue = "tabletop" | "wall" | "multipoint";

export const isSingleQrMode = (mode: string | null | undefined): boolean =>
  mode === "tabletop" || mode === "wall";

/** Tabletop/Wall projects that count toward the free cap (any status). */
export function countFreeModels(projects: ReadonlyArray<{ mode: string | null }>): number {
  return projects.filter((p) => isSingleQrMode(p.mode)).length;
}

export interface QuotaState {
  used: number;
  cap: number;
  /** null for paid accounts — no cap applies. */
  remaining: number | null;
  reached: boolean;
}

export function quotaState(plan: Plan, used: number, cap = FREE_MODEL_CAP): QuotaState {
  if (plan === "paid") return { used, cap, remaining: null, reached: false };
  const remaining = Math.max(0, cap - used);
  return { used, cap, remaining, reached: remaining === 0 };
}

/** Can this account create a new project in `mode` right now? */
export function canCreate(mode: ExperienceModeValue, plan: Plan, usedFreeModels: number): boolean {
  if (plan === "paid") return true;
  if (mode === "multipoint") return false;
  return usedFreeModels < FREE_MODEL_CAP;
}

export const PLAN_COPY = {
  capReached: `You've used all ${FREE_MODEL_CAP} free Tabletop/Wall models. Delete one you no longer need, or contact Archi AR to upgrade.`,
  spatialLocked:
    "Spatial places the model at full scale in the real room using three or more printed markers. It's part of the paid plan. Payments aren't live yet — contact Archi AR and we'll unlock it for your account.",
  entitlementReadOnly: "Your plan can only be changed by Archi AR. Contact us if something looks wrong.",
} as const;

/**
 * Turns a Supabase/Postgres error raised by the migration-009 triggers into
 * friendly copy. Returns null when the error isn't one of ours, so callers can
 * fall back to their generic message.
 */
export function planErrorMessage(err: unknown): string | null {
  const text =
    typeof err === "string"
      ? err
      : err && typeof err === "object" && "message" in err
        ? String((err as { message: unknown }).message ?? "")
        : "";
  if (text.includes("FREE_MODEL_CAP_REACHED")) return PLAN_COPY.capReached;
  if (text.includes("SPATIAL_REQUIRES_PAID")) return PLAN_COPY.spatialLocked;
  if (text.includes("ENTITLEMENT_READ_ONLY")) return PLAN_COPY.entitlementReadOnly;
  return null;
}

/** planErrorMessage, or the error's own message, or a generic fallback. */
export function friendlyError(err: unknown, fallback = "An unexpected error occurred"): string {
  const mapped = planErrorMessage(err);
  if (mapped) return mapped;
  if (err && typeof err === "object" && "message" in err) {
    const m = String((err as { message: unknown }).message ?? "");
    if (m) return m;
  }
  return fallback;
}
