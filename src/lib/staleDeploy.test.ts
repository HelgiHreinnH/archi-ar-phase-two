import { describe, it, expect, vi, beforeEach } from "vitest";
import { isChunkLoadError, reloadForNewDeploy } from "./staleDeploy";

describe("isChunkLoadError", () => {
  it.each([
    "Importing a module script failed.", // Safari
    "Failed to fetch dynamically imported module: https://x/assets/NewProject-abc.js", // Chrome
    "error loading dynamically imported module", // Firefox
    "'text/html' is not a valid JavaScript MIME type.",
  ])("recognises %s", (m) => expect(isChunkLoadError(new TypeError(m))).toBe(true));
  it("ignores other errors", () => expect(isChunkLoadError(new Error("Network request failed"))).toBe(false));
});

describe("reloadForNewDeploy", () => {
  const store = new Map<string, string>();
  const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
  beforeEach(() => {
    store.clear();
    vi.stubGlobal("window", { location: { reload: vi.fn() } });
  });
  it("reloads once, then not again within the guard window", () => {
    expect(reloadForNewDeploy(1_000_000, storage)).toBe(true);
    expect(reloadForNewDeploy(1_005_000, storage)).toBe(false);
    expect(reloadForNewDeploy(1_020_000, storage)).toBe(true);
  });
});
