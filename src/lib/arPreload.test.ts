import { beforeEach, describe, expect, it, vi } from "vitest";

const idb = new Map<string, ArrayBuffer>();
vi.mock("@/lib/assetCache", () => ({
  buildAssetKey: (s: string, r: string, t: string) => `${s}::${r}::${t}`,
  getCachedAsset: vi.fn(async (k: string) => idb.get(k) ?? null),
  setCachedAsset: vi.fn(async (k: string, d: ArrayBuffer) => { idb.set(k, d); }),
}));
vi.mock("@/lib/xr8Engine", () => ({ loadXr8: vi.fn(() => Promise.resolve({})) }));
vi.mock("@/lib/mindarEngine", () => ({ loadMindAR: vi.fn(() => Promise.resolve()) }));
vi.mock("@/lib/xr8QrTarget", () => ({ buildQrImageTarget: vi.fn(async () => ({ name: "archi-qr" })) }));

import {
  __resetARPreloadForTests,
  assetKey,
  modelCacheKeyFor,
  preloadModel,
  preloadQrTarget,
  preloadTrackingFile,
  subscribeModelProgress,
  takePreloadedTrackingFile,
} from "./arPreload";
import { buildQrImageTarget } from "@/lib/xr8QrTarget";

function streamResponse(bytes: number[], chunk = 2): Response {
  const data = new Uint8Array(bytes);
  let i = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(c) {
      if (i >= data.length) { c.close(); return; }
      c.enqueue(data.slice(i, i + chunk));
      i += chunk;
    },
  });
  return new Response(body, { status: 200, headers: { "content-length": String(data.length) } });
}

describe("arPreload", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    __resetARPreloadForTests();
    idb.clear();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  it("keys signed URLs by path, so a re-signed URL joins the same download", async () => {
    expect(assetKey("https://x/a.glb?token=1")).toBe("https://x/a.glb");
    fetchMock.mockResolvedValue(streamResponse([1, 2, 3, 4]));
    const a = preloadModel("https://x/a.glb?token=1");
    const b = preloadModel("https://x/a.glb?token=2");
    expect(a).toBe(b);
    expect(new Uint8Array(await a)).toEqual(new Uint8Array([1, 2, 3, 4]));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reports progress and ends at 1", async () => {
    fetchMock.mockResolvedValue(streamResponse([1, 2, 3, 4, 5, 6, 7, 8]));
    const p = preloadModel("https://x/b.glb");
    const seen: (number | null)[] = [];
    subscribeModelProgress("https://x/b.glb", (f) => seen.push(f));
    await p;
    expect(seen[seen.length - 1]).toBe(1);
    expect(seen.some((f) => f != null && f > 0 && f < 1)).toBe(true);
  });

  it("serves a warm visit from IndexedDB and caches a cold one", async () => {
    const key = modelCacheKeyFor("share", "2026-10-04T10:00:00Z");
    fetchMock.mockResolvedValue(streamResponse([9, 9]));
    await preloadModel("https://x/c.glb", key);
    expect(idb.has(key)).toBe(true);
    __resetARPreloadForTests();
    fetchMock.mockClear();
    const buf = await preloadModel("https://x/c.glb", key);
    expect(new Uint8Array(buf)).toEqual(new Uint8Array([9, 9]));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("forgets a failed download so the viewer can retry", async () => {
    fetchMock.mockResolvedValueOnce(new Response("no", { status: 403 }));
    await expect(preloadModel("https://x/d.glb")).rejects.toThrow("HTTP 403");
    fetchMock.mockResolvedValueOnce(streamResponse([1, 2]));
    await expect(preloadModel("https://x/d.glb")).resolves.toBeInstanceOf(ArrayBuffer);
  });

  it("hands the preloaded .mind to the scene; nothing preloaded → null (Spatial)", async () => {
    fetchMock.mockResolvedValue(new Response(new Uint8Array([7, 7]), { status: 200 }));
    expect(takePreloadedTrackingFile("https://x/t.mind?s=1")).toBeNull();
    void preloadTrackingFile("https://x/t.mind?s=1");
    const p = takePreloadedTrackingFile("https://x/t.mind?s=2");
    expect(p).not.toBeNull();
    expect(new Uint8Array(await p!)).toEqual(new Uint8Array([7, 7]));
  });

  it("builds the 8th Wall QR target once per experience", async () => {
    const a = preloadQrTarget("https://x/qr.png", "share", 150);
    const b = preloadQrTarget("https://x/qr.png?again", "share", 150);
    expect(a).toBe(b);
    await a;
    expect(buildQrImageTarget).toHaveBeenCalledTimes(1);
  });
});
