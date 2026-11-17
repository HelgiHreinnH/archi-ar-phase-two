/**
 * Account deletion, browser side: the confirmation phrase and "Download my models" (.zip).
 *
 * Flow (Helgi, 17 Nov 2026): 1. Delete account → what will be removed; 2. download the models
 * or go straight on; 3. type "DELETE <email name>" to confirm. The server checks the same
 * phrase (supabase/functions/delete-user-data/core.ts).
 */
import { Zip, ZipPassThrough } from "fflate";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";

export { confirmPhrase, phraseMatches } from "../../supabase/functions/delete-user-data/core";

type ProjectLite = Pick<Tables<"projects">, "id" | "name" | "model_url">;

/** File names inside the zip: project name, ASCII-safe, unique, `.glb`. */
export function zipEntryNames(projects: ReadonlyArray<Pick<ProjectLite, "name">>): string[] {
  const map: Record<string, string> = { æ: "ae", ø: "oe", å: "aa", Æ: "Ae", Ø: "Oe", Å: "Aa", ð: "d", Ð: "D", þ: "th", Þ: "Th", ß: "ss" };
  const used = new Set<string>();
  return projects.map((p) => {
    const base = (p.name || "model")
      .replace(/[æøåÆØÅðÐþÞß]/g, (c) => map[c])
      .normalize("NFKD").replace(/[̀-ͯ]/g, "")
      .replace(/[^A-Za-z0-9._ -]/g, "_")
      .trim() || "model";
    let name = `${base}.glb`;
    for (let n = 2; used.has(name.toLowerCase()); n++) name = `${base} (${n}).glb`;
    used.add(name.toLowerCase());
    return name;
  });
}

/** What the dialog says will be deleted. */
export async function accountSummary(): Promise<{ projects: ProjectLite[]; models: number }> {
  const { data, error } = await supabase.from("projects").select("id, name, model_url").order("created_at");
  if (error) throw error;
  const projects = (data ?? []) as ProjectLite[];
  return { projects, models: projects.filter((p) => !!p.model_url).length };
}

/**
 * Zip the stored GLB of every project and download it. Models only — no QR codes or marker
 * sheets. Built in the browser (a server function has too little memory for several 50 MB
 * models). GLBs are already compressed, so entries are stored, not deflated.
 * Returns the number of models in the zip.
 */
export async function downloadModelsZip(
  projects: ReadonlyArray<ProjectLite>,
  onProgress: (done: number, total: number) => void = () => {},
): Promise<number> {
  const withModel = projects.filter((p) => !!p.model_url);
  if (!withModel.length) return 0;
  const names = zipEntryNames(withModel);

  const chunks: Uint8Array[] = [];
  let failed: unknown = null;
  const zip = new Zip((err, chunk) => {
    if (err) failed = err;
    else chunks.push(chunk);
  });

  for (let i = 0; i < withModel.length; i++) {
    onProgress(i, withModel.length);
    const { data, error } = await supabase.storage.from("project-models").createSignedUrl(withModel[i].model_url!, 600);
    if (error || !data?.signedUrl) throw error ?? new Error("No download link");
    const res = await fetch(data.signedUrl);
    if (!res.ok) throw new Error(`Download failed (${res.status})`);
    const entry = new ZipPassThrough(names[i]);
    zip.add(entry);
    entry.push(new Uint8Array(await res.arrayBuffer()), true);
    if (failed) throw failed;
  }
  zip.end();
  if (failed) throw failed;
  onProgress(withModel.length, withModel.length);

  const url = URL.createObjectURL(new Blob(chunks, { type: "application/zip" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `archi-ar-models-${new Date().toISOString().slice(0, 10)}.zip`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return withModel.length;
}
