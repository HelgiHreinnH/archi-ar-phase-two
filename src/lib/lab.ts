/**
 * lab.ts — TEMPORARY routing for the Spatial engine bake-off (Sep 2026).
 *
 * Each test site is its own Netlify project that sets VITE_LAB_ENGINE:
 *   archi-ar-8thwall  → "8thwall"  → schema lab_8thwall,  bucket lab-8thwall
 *   archi-ar-zappar   → "zappar"   → schema lab_zappar,   bucket lab-zappar
 *   archi-ar-immersal → "immersal" → schema lab_immersal, bucket lab-immersal
 * Production (designingforusers.com) leaves it unset → LAB is null and
 * nothing here is used. See migration 010. Delete this file (and the lab
 * schemas) once the winning engine is merged into main.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

export const LAB_ENGINES = ["8thwall", "zappar", "immersal"] as const;
export type LabEngine = (typeof LAB_ENGINES)[number];

export interface LabConfig {
  engine: LabEngine;
  schema: `lab_${LabEngine}`;
  bucket: `lab-${LabEngine}`;
}

export function resolveLab(raw: string | undefined | null): LabConfig | null {
  const v = (raw ?? "").trim().toLowerCase();
  if (!(LAB_ENGINES as readonly string[]).includes(v)) return null;
  const engine = v as LabEngine;
  return { engine, schema: `lab_${engine}`, bucket: `lab-${engine}` };
}

/** The lab this build belongs to, or null on production. */
export const LAB: LabConfig | null = resolveLab(import.meta.env.VITE_LAB_ENGINE);

function requireLab(): LabConfig {
  if (!LAB) throw new Error("Lab routing used outside a lab build (VITE_LAB_ENGINE is not set).");
  return LAB;
}

/** Postgres client scoped to this lab's schema (test_runs, sites). */
export function labDb() {
  const lab = requireLab();
  // The generated Database type only knows `public`; lab schemas are untyped on purpose.
  return (supabase as unknown as SupabaseClient).schema(lab.schema);
}

/** Storage bucket for this lab. Paths must start with `<user_id>/` (RLS). */
export function labStorage() {
  return supabase.storage.from(requireLab().bucket);
}
