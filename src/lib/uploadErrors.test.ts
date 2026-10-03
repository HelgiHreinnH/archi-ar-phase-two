import { describe, it, expect } from "vitest";
import { describeUploadError, STORAGE_MAX_UPLOAD_MB } from "./uploadErrors";

describe("describeUploadError", () => {
  it("reads 413 out of a Supabase 400 body (the real 3 Oct 2026 failure)", () => {
    const body = JSON.stringify({ statusCode: "413", error: "Payload too large", message: "The object exceeded the maximum allowed size" });
    const e = describeUploadError(400, body, 62_766_600);
    expect(e.kind).toBe("too-large");
    expect(e.message).toContain("59.9 MB");
    expect(e.message).toContain(`${STORAGE_MAX_UPLOAD_MB} MB`);
    expect(e.detail).toContain("storage 413");
  });
  it("network failure", () => expect(describeUploadError(0).kind).toBe("network"));
  it("expired JWT", () => expect(describeUploadError(400, JSON.stringify({ statusCode: "403", error: "Unauthorized", message: "jwt expired" })).kind).toBe("auth"));
  it("RLS", () => expect(describeUploadError(400, JSON.stringify({ statusCode: "403", message: "new row violates row-level security policy" })).kind).toBe("permission"));
  it("invalid key", () => expect(describeUploadError(400, JSON.stringify({ statusCode: "400", error: "InvalidKey", message: "Invalid key: a/b/ø.glb" })).kind).toBe("bad-name"));
  it("mime", () => expect(describeUploadError(400, JSON.stringify({ statusCode: "415", message: "mime type not supported" })).kind).toBe("file-type"));
  it("5xx", () => expect(describeUploadError(502, "<html>").kind).toBe("server"));
  it("unknown keeps server message", () => {
    const e = describeUploadError(400, JSON.stringify({ statusCode: "400", message: "Something odd" }));
    expect(e.kind).toBe("unknown");
    expect(e.message).toContain("Something odd");
  });
});
