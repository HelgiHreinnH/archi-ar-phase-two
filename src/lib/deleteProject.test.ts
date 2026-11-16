// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

/** A tiny in-memory stand-in for the Supabase client: two buckets and one table. */
const calls: string[] = [];
let files: Record<string, string[]> = {};
let failStorage = false;

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    storage: {
      from: (bucket: string) => ({
        list: async (path: string) => {
          if (failStorage) return { data: null, error: new Error("storage down") };
          const seen = new Map<string, string | null>();
          for (const f of files[bucket] ?? []) {
            if (!f.startsWith(path + "/")) continue;
            const [head, ...rest] = f.slice(path.length + 1).split("/");
            seen.set(head, rest.length ? null : "id");
          }
          return { data: [...seen].map(([name, id]) => ({ name, id })), error: null };
        },
        remove: async (paths: string[]) => {
          calls.push(`remove ${bucket}: ${[...paths].sort().join(", ")}`);
          files[bucket] = (files[bucket] ?? []).filter((f) => !paths.includes(f));
          return { data: [], error: null };
        },
      }),
    },
    from: (table: string) => ({
      delete: () => ({
        eq: async (_col: string, id: string) => {
          calls.push(`delete ${table} ${id}`);
          return { error: null };
        },
      }),
    }),
  },
}));

import { deleteProject } from "./projectActions";

beforeEach(() => {
  calls.length = 0;
  failStorage = false;
  files = {
    "project-models": ["p1/mwj7ihau/koekken_archiar.glb", "p2/abc/office.glb"],
    "project-assets": ["p1/qr_code.png", "p1/thumbnail-v2.jpg", "p1/markers/marker_1.png", "p2/qr_code.png"],
  };
});

describe("deleteProject", () => {
  it("removes the project's files from both buckets, then the row", async () => {
    await deleteProject("p1");
    expect(calls).toEqual([
      "remove project-models: p1/mwj7ihau/koekken_archiar.glb",
      "remove project-assets: p1/markers/marker_1.png, p1/qr_code.png, p1/thumbnail-v2.jpg",
      "delete projects p1",
    ]);
  });

  it("never touches another project's files", async () => {
    await deleteProject("p1");
    expect(files["project-models"]).toEqual(["p2/abc/office.glb"]);
    expect(files["project-assets"]).toEqual(["p2/qr_code.png"]);
  });

  it("still deletes the row when storage cannot be reached", async () => {
    failStorage = true;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await deleteProject("p1");
    expect(calls).toEqual(["delete projects p1"]);
    warn.mockRestore();
  });
});
