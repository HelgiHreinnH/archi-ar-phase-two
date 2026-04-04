import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * Edge function: get-public-project
 *
 * Rate-limited proxy for public AR experience lookup by share_link UUID.
 * Returns signed URLs for all storage assets (buckets are private).
 */

const RATE_LIMIT_MAX = 60;
const RATE_LIMIT_WINDOW_MS = 60_000;
const SIGNED_URL_EXPIRY = 900; // 15 minutes

const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);

  if (entry && now < entry.resetAt) {
    if (entry.count >= RATE_LIMIT_MAX) return false;
    entry.count++;
    return true;
  }

  rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });

  if (rateLimitMap.size > 5000) {
    for (const [key, val] of rateLimitMap) {
      if (now > val.resetAt) rateLimitMap.delete(key);
    }
  }

  return true;
}

/** Generate a signed URL for a storage path. Returns null on failure. */
async function signUrl(
  supabase: ReturnType<typeof createClient>,
  bucket: string,
  path: string | null | undefined
): Promise<string | null> {
  if (!path) return null;
  // If it's already a full URL, extract the storage path
  const storePath = extractStoragePath(path, bucket);
  if (!storePath) return null;

  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(storePath, SIGNED_URL_EXPIRY);

  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}

/** Extract the storage path from a value that might be a full public URL or a bare path */
function extractStoragePath(
  value: string,
  bucket: string
): string | null {
  if (!value) return null;
  // If it starts with http, extract the path after /object/public/{bucket}/
  if (value.startsWith("http")) {
    const patterns = [
      `/object/public/${bucket}/`,
      `/object/sign/${bucket}/`,
    ];
    for (const pattern of patterns) {
      const idx = value.indexOf(pattern);
      if (idx !== -1) {
        // Strip query params
        const raw = value.substring(idx + pattern.length);
        return raw.split("?")[0];
      }
    }
    return null; // Can't parse — unknown URL format
  }
  return value; // Already a bare path
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const clientIp =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown";

  if (!checkRateLimit(clientIp)) {
    return new Response(
      JSON.stringify({ error: "Too many requests. Please try again later." }),
      {
        status: 429,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
          "Retry-After": "60",
        },
      }
    );
  }

  try {
    const { shareId } = await req.json();

    if (!shareId || typeof shareId !== "string") {
      return new Response(
        JSON.stringify({ error: "Missing or invalid shareId" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(shareId)) {
      return new Response(
        JSON.stringify({ error: "Invalid share link format" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data, error } = await supabase
      .from("projects")
      .select(
        "name, description, client_name, model_url, mode, scale, marker_data, status, initial_rotation, mind_file_url, marker_image_urls, qr_code_url"
      )
      .eq("share_link", shareId)
      .eq("status", "active")
      .single();

    if (error || !data) {
      return new Response(
        JSON.stringify({ error: "Experience not found or inactive" }),
        {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Sign all storage URLs so private buckets work
    const [signedModelUrl, signedMindFileUrl, signedQrCodeUrl] =
      await Promise.all([
        signUrl(supabase, "project-models", data.model_url),
        signUrl(supabase, "project-assets", data.mind_file_url),
        signUrl(supabase, "project-assets", data.qr_code_url),
      ]);

    // Sign marker image URLs (object with string values)
    let signedMarkerImageUrls: Record<string, string> | null = null;
    if (data.marker_image_urls && typeof data.marker_image_urls === "object") {
      const urls = data.marker_image_urls as Record<string, string>;
      const entries = await Promise.all(
        Object.entries(urls).map(async ([key, val]) => {
          const signed = await signUrl(supabase, "project-assets", val);
          return [key, signed || val] as [string, string];
        })
      );
      signedMarkerImageUrls = Object.fromEntries(entries);
    }

    const responseData = {
      ...data,
      model_url: signedModelUrl,
      mind_file_url: signedMindFileUrl,
      qr_code_url: signedQrCodeUrl,
      marker_image_urls: signedMarkerImageUrls,
    };

    return new Response(JSON.stringify(responseData), {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=300",
      },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
