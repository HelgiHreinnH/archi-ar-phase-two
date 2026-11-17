// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
import { unzipSync, Zip, ZipPassThrough } from "fflate";
import { deleteAccount, type AdminLike } from "../../supabase/functions/delete-user-data/core";
import { confirmPhrase, phraseMatches, zipEntryNames } from "./accountDeletion";

describe("confirmation phrase", () => {
  it("is DELETE plus the part of the email before @", () => {
    expect(confirmPhrase("Helgi.Hreinn@Example.com")).toBe("DELETE helgi.hreinn");
  });

  it("forgives case and extra spaces, nothing else", () => {
    const email = "helgi@example.com";
    for (const ok of ["DELETE helgi", "delete helgi", "  Delete   HELGI "]) expect(phraseMatches(ok, email), ok).toBe(true);
    for (const bad of ["DELETE", "helgi", "DELETE helgi@example.com", "SLET helgi", "DELETE helgix", "", null, 42]) {
      expect(phraseMatches(bad, email), String(bad)).toBe(false);
    }
    expect(phraseMatches("DELETE ", "")).toBe(false);
  });
});

describe("zip entry names", () => {
  it("uses the project name, ASCII-safe and unique", () => {
    expect(zipEntryNames([{ name: "Køkken 2" }, { name: "office" }, { name: "Office" }, { name: "" }, { name: "a/b" }]))
      .toEqual(["Koekken 2.glb", "office.glb", "Office (2).glb", "model.glb", "a_b.glb"]);
  });

  it("the streaming zip fflate builds reads back byte for byte", () => {
    const chunks: Uint8Array[] = [];
    const zip = new Zip((err, c) => { if (err) throw err; chunks.push(c); });
    const glb = new Uint8Array(3000).map((_, i) => i % 251);
    const entry = new ZipPassThrough("Koekken 2.glb");
    zip.add(entry);
    entry.push(glb, true);
    zip.end();
    const all = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
    let at = 0;
    for (const c of chunks) { all.set(c, at); at += c.length; }
    expect(Array.from(unzipSync(all)["Koekken 2.glb"])).toEqual(Array.from(glb));
  });
});

/** In-memory storage + tables, logging every destructive call in order. */
function fakeAdmin(files: Record<string, string[]>, opts: { stuck?: string; authFails?: boolean } = {}) {
  const log: string[] = [];
  const admin: AdminLike = {
    async listFolder(bucket, path) {
      if (!(bucket in files)) throw new Error("no bucket");
      const seen = new Map<string, string | null>();
      for (const f of files[bucket]) {
        if (!f.startsWith(path + "/")) continue;
        const [head, ...rest] = f.slice(path.length + 1).split("/");
        seen.set(head, rest.length ? null : "id");
      }
      return [...seen].map(([name, id]) => ({ name, id }));
    },
    async removeFiles(bucket, paths) {
      log.push(`remove ${bucket} ${paths.length}`);
      files[bucket] = files[bucket].filter((f) => !paths.includes(f) || f === opts.stuck);
    },
    async projectIds() { return ["p1", "p2"]; },
    async deleteRows() { log.push("rows"); },
    async deleteAuthUser() { log.push("auth"); if (opts.authFails) throw new Error("owns objects"); },
  };
  return { admin, log };
}

const stored = () => ({
  "project-models": ["p1/up1/koekken.glb", "p2/up9/office.glb", "other/up/x.glb"],
  "project-assets": ["p1/qr_code.png", "p1/markers/marker_1.png", "p1/thumbnail-v2.jpg", "p2/qr_code.png"],
  "lab-8thwall": ["u1/site/scan.bin"],
});

describe("deleteAccount", () => {
  it("removes nested files too, then rows, then the login — in that order", async () => {
    const files = stored();
    const { admin, log } = fakeAdmin(files);
    expect(await deleteAccount(admin, "u1")).toEqual({ ok: true, filesRemoved: 7 });
    expect(log).toEqual(["remove project-models 2", "remove project-assets 4", "remove lab-8thwall 1", "rows", "auth"]);
    // The old function left exactly these behind (one folder level only):
    expect(files["project-models"]).toEqual(["other/up/x.glb"]);
    expect(files["project-assets"]).toEqual([]);
  });

  it("stops before rows and login when a file will not go", async () => {
    const { admin, log } = fakeAdmin(stored(), { stuck: "p1/up1/koekken.glb" });
    const r = await deleteAccount(admin, "u1");
    expect(r).toMatchObject({ ok: false, stage: "files", filesLeft: 1 });
    expect(log).not.toContain("rows");
    expect(log).not.toContain("auth");
  });

  it("reports a failed login delete instead of claiming success", async () => {
    const { admin } = fakeAdmin(stored(), { authFails: true });
    expect(await deleteAccount(admin, "u1")).toMatchObject({ ok: false, stage: "auth" });
  });

  it("does not trip over a lab bucket that no longer exists", async () => {
    const files: Record<string, string[]> = { "project-models": ["p1/a/m.glb"], "project-assets": [] };
    const { admin } = fakeAdmin(files);
    expect(await deleteAccount(admin, "u1")).toEqual({ ok: true, filesRemoved: 1 });
  });
});
