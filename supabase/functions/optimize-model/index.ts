// Phase 5.2 — Automatic GLB optimization at upload time.
// Pipes the uploaded GLB through @gltf-transform: dedup + prune + weld + Draco
// geometry compression. Texture compression is intentionally skipped (no native
// image codec available in edge-runtime); Draco alone routinely yields 3–5× on
// architectural / mesh-heavy models.
//
// On success the project's model_url points at `${projectId}/optimized.glb` and
// the original is preserved at `original_model_url`. On any failure we leave
// the project pointing at the original — never block the user.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { NodeIO } from "npm:@gltf-transform/core@^4.1.1";
import { ALL_EXTENSIONS } from "npm:@gltf-transform/extensions@^4.1.1";
import { dedup, prune, weld, draco } from "npm:@gltf-transform/functions@^4.1.1";
import draco3d from "npm:draco3dgltf@^1.5.7";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface Body {
  projectId: string;
  inputPath: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return json({ error: "Unauthorized" }, 401);
    }

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: claims, error: claimsErr } = await userClient.auth.getClaims(
      authHeader.replace("Bearer ", ""),
    );
    if (claimsErr || !claims?.claims?.sub) {
      return json({ error: "Unauthorized" }, 401);
    }
    const userId = claims.claims.sub;

    const body = (await req.json()) as Body;
    if (!body?.projectId || !body?.inputPath) {
      return json({ error: "projectId and inputPath required" }, 400);
    }

    // Service-role client for storage + project update (bypasses RLS, but we
    // verify ownership manually first).
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: project, error: projErr } = await admin
      .from("projects")
      .select("id, user_id, model_url, original_model_url")
      .eq("id", body.projectId)
      .single();
    if (projErr || !project) return json({ error: "Project not found" }, 404);
    if (project.user_id !== userId) return json({ error: "Forbidden" }, 403);

    // Skip non-GLB (USDZ etc.)
    if (!body.inputPath.toLowerCase().endsWith(".glb")) {
      return json({ ok: true, skipped: "non-glb" });
    }

    // ── Download original ──
    const { data: blob, error: dlErr } = await admin.storage
      .from("project-models")
      .download(body.inputPath);
    if (dlErr || !blob) {
      return json({ error: `Download failed: ${dlErr?.message ?? "unknown"}` }, 500);
    }
    const originalBytes = new Uint8Array(await blob.arrayBuffer());
    const originalSize = originalBytes.byteLength;

    // ── Optimize ──
    const io = new NodeIO()
      .registerExtensions(ALL_EXTENSIONS)
      .registerDependencies({
        "draco3d.decoder": await draco3d.createDecoderModule(),
        "draco3d.encoder": await draco3d.createEncoderModule(),
      });

    let optimizedBytes: Uint8Array;
    try {
      const document = await io.readBinary(originalBytes);
      await document.transform(
        dedup(),
        prune(),
        weld(),
        draco({ method: "edgebreaker" }),
      );
      optimizedBytes = await io.writeBinary(document);
    } catch (err) {
      console.error("[optimize-model] Pipeline failed:", err);
      return json({
        ok: false,
        error: `Optimization failed: ${(err as Error).message}`,
      }, 200);
    }
    const optimizedSize = optimizedBytes.byteLength;

    // If the "optimized" file is larger (rare, e.g. tiny already-Draco models),
    // just keep the original.
    if (optimizedSize >= originalSize) {
      return json({
        ok: true,
        skipped: "no-gain",
        originalSize,
        optimizedSize,
      });
    }

    // ── Upload optimized ──
    const optimizedPath = `${body.projectId}/optimized.glb`;
    const { error: upErr } = await admin.storage
      .from("project-models")
      .upload(optimizedPath, optimizedBytes, {
        contentType: "model/gltf-binary",
        upsert: true,
      });
    if (upErr) {
      return json({ ok: false, error: `Upload failed: ${upErr.message}` }, 200);
    }

    // ── Update project record ──
    // Preserve the original_model_url only on the FIRST optimization run, so
    // re-uploads always retain the latest user-provided source.
    const updates: Record<string, string> = { model_url: optimizedPath };
    if (!project.original_model_url || project.original_model_url !== body.inputPath) {
      updates.original_model_url = body.inputPath;
    }
    const { error: updErr } = await admin
      .from("projects")
      .update(updates)
      .eq("id", body.projectId);
    if (updErr) {
      return json({ ok: false, error: `DB update failed: ${updErr.message}` }, 200);
    }

    const ratio = +(originalSize / optimizedSize).toFixed(2);
    console.log(
      `[optimize-model] ${body.projectId}: ${originalSize} → ${optimizedSize} (${ratio}×)`,
    );
    return json({
      ok: true,
      optimizedPath,
      originalSize,
      optimizedSize,
      ratio,
    });
  } catch (err) {
    console.error("[optimize-model] Unexpected error:", err);
    return json({ ok: false, error: (err as Error).message }, 200);
  }
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
