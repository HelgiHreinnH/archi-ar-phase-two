import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { resolveLab } from "./lab";

describe("resolveLab", () => {
  it("maps each engine to its schema and bucket", () => {
    expect(resolveLab("8thwall")).toEqual({ engine: "8thwall", schema: "lab_8thwall", bucket: "lab-8thwall" });
    expect(resolveLab("zappar")).toEqual({ engine: "zappar", schema: "lab_zappar", bucket: "lab-zappar" });
    expect(resolveLab("immersal")).toEqual({ engine: "immersal", schema: "lab_immersal", bucket: "lab-immersal" });
  });

  it("tolerates case and whitespace", () => {
    expect(resolveLab(" Zappar ")?.schema).toBe("lab_zappar");
  });

  it("returns null for production and unknown values", () => {
    expect(resolveLab(undefined)).toBeNull();
    expect(resolveLab("")).toBeNull();
    expect(resolveLab("public")).toBeNull();
  });
});
