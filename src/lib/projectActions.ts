import { supabase } from "@/integrations/supabase/client";
import type { Tables, TablesInsert } from "@/integrations/supabase/types";
import { thumbnailPath } from "@/lib/thumbnailPath";

type Project = Tables<"projects">;

/**
 * Archive (Oct 2026, Helgi): hides the experience AND switches the client
 * link off. The public viewer (get-public-project) only serves
 * status = 'active', so 'archived' is enough — no schema change. Archived
 * Tabletop/Wall projects still count toward the free cap (the cap counts
 * every row of those modes); only Delete frees a slot.
 */
export const ARCHIVED = "archived";

export const isArchived = (p: Pick<Project, "status">) => p.status === ARCHIVED;

/** Status to restore to: live again if it was generated, otherwise a draft. */
export function restoredStatus(p: Pick<Project, "mind_file_url" | "share_link">): "active" | "draft" {
  return p.mind_file_url && p.share_link ? "active" : "draft";
}

/** "Office" → "Office (copy)", "Office (copy)" → "Office (copy 2)". */
export function copyName(name: string, existing: ReadonlyArray<string>): string {
  const base = name.replace(/ \(copy(?: \d+)?\)$/, "");
  let candidate = `${base} (copy)`;
  for (let n = 2; existing.includes(candidate); n++) candidate = `${base} (copy ${n})`;
  return candidate;
}

/**
 * Duplicate a project as a new draft: same settings and model, no share link,
 * no QR/tracking file (those are generated per experience). The model and
 * preview image are copied into the new project's own storage folder.
 */
export async function duplicateProject(source: Project, existingNames: ReadonlyArray<string>): Promise<Project> {
  const insert: TablesInsert<"projects"> = {
    user_id: source.user_id,
    name: copyName(source.name, existingNames),
    mode: source.mode,
    client_name: source.client_name,
    location: source.location,
    description: source.description,
    scale: source.scale,
    qr_size: source.qr_size,
    initial_rotation: source.initial_rotation,
    optimize_model: source.optimize_model,
    marker_data: source.marker_data,
    status: "draft",
  };
  const { data: created, error } = await supabase.from("projects").insert(insert).select().single();
  if (error) throw error;

  if (source.model_url) {
    const fileName = source.model_url.split("/").pop()!;
    const newPath = `${created.id}/${Date.now().toString(36)}/${fileName}`;
    const { error: copyErr } = await supabase.storage.from("project-models").copy(source.model_url, newPath);
    if (copyErr) {
      // Keep the draft (settings are copied) but say the model needs uploading.
      console.warn("[duplicateProject] model copy failed:", copyErr);
      return created as Project;
    }
    await supabase.from("projects").update({ model_url: newPath }).eq("id", created.id);
    // Preview image: best effort.
    void supabase.storage.from("project-assets").copy(thumbnailPath(source.id), thumbnailPath(created.id)).catch(() => {});
    return { ...(created as Project), model_url: newPath };
  }
  return created as Project;
}
