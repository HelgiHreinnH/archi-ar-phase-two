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

/**
 * Status to restore to: live again if it was generated, otherwise a draft.
 * "Generated" means the tracking asset exists: the printed QR for Tabletop/Wall
 * (8th Wall builds its target from it — no .mind since 16 Nov 2026), the
 * compiled .mind for Spatial.
 */
export function restoredStatus(
  p: Pick<Project, "mode" | "mind_file_url" | "qr_code_url" | "share_link">,
): "active" | "draft" {
  const singleQr = p.mode === "tabletop" || p.mode === "wall";
  const generated = singleQr ? !!p.qr_code_url : !!p.mind_file_url;
  return generated && p.share_link ? "active" : "draft";
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

/** The two private buckets that hold a project's files, each under `<projectId>/`. */
const PROJECT_BUCKETS = ["project-models", "project-assets"] as const;

type ListEntry = { name: string; id: string | null };
type ListFn = (path: string) => Promise<ListEntry[]>;

/**
 * Every file under `prefix`, walking sub-folders. Storage `list()` returns one
 * level only, and a project nests: models live in `<id>/<uploadId>/file.glb`,
 * marker images in `<id>/markers/`. Folders come back with `id: null`.
 */
export async function collectFiles(list: ListFn, prefix: string, depth = 4): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await list(prefix)) {
    const path = `${prefix}/${entry.name}`;
    if (entry.id) files.push(path);
    else if (depth > 0) files.push(...(await collectFiles(list, path, depth - 1)));
  }
  return files;
}

/**
 * Delete a project AND its stored files.
 *
 * Until 16 Nov 2026 the three delete buttons removed only the database row.
 * Model, preview image, marker images, QR and tracking file stayed in storage,
 * where nobody could reach them any more: the storage policies grant access
 * through the project row. 14 of 18 project folders had no row.
 *
 * Files go first, while the row still gives the owner the right to remove
 * them. A storage failure is logged and does not block the delete — leaving
 * the experience on the dashboard would be worse than a leftover file.
 */
export async function deleteProject(projectId: string): Promise<void> {
  for (const bucket of PROJECT_BUCKETS) {
    try {
      const list: ListFn = async (path) => {
        const { data, error } = await supabase.storage.from(bucket).list(path, { limit: 1000 });
        if (error) throw error;
        return (data ?? []) as ListEntry[];
      };
      const files = await collectFiles(list, projectId);
      // Belt and braces: only ever this project's folder.
      const own = files.filter((f) => f.startsWith(`${projectId}/`));
      if (own.length) {
        const { error } = await supabase.storage.from(bucket).remove(own);
        if (error) throw error;
      }
    } catch (err) {
      console.warn(`[deleteProject] could not clear ${bucket}/${projectId}:`, err);
    }
  }
  const { error } = await supabase.from("projects").delete().eq("id", projectId);
  if (error) throw error;
}
