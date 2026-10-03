/**
 * Upload error dissection (Oct 2026).
 *
 * Supabase Storage answers almost every rejected upload with HTTP 400 and puts
 * the real reason in the JSON body: `{ statusCode: "413", error:
 * "Payload too large", message: "The object exceeded the maximum allowed size" }`.
 * Showing "Upload failed with status 400" tells the architect nothing, so we
 * read the body, classify it, and return a plain-language message plus a tip
 * they can act on.
 */

/**
 * Largest single file Supabase Storage accepts on the current plan. The Free
 * plan caps every object at 50 MB project-wide, regardless of the bucket's own
 * `file_size_limit` (250 MB). Raise this when the project moves to Pro and the
 * global limit is raised in Dashboard → Storage → Settings.
 */
export const STORAGE_MAX_UPLOAD_MB = 50;
export const STORAGE_MAX_UPLOAD_BYTES = STORAGE_MAX_UPLOAD_MB * 1024 * 1024;

export type UploadErrorKind =
  | "too-large"
  | "auth"
  | "permission"
  | "conflict"
  | "file-type"
  | "bad-name"
  | "rate-limit"
  | "server"
  | "network"
  | "unknown";

export interface UploadErrorInfo {
  kind: UploadErrorKind;
  /** One sentence: what went wrong. */
  message: string;
  /** What to do about it. */
  tip: string;
  /** Technical detail for support / console (status + server code). */
  detail: string;
}

interface StorageErrorBody {
  statusCode?: string | number;
  error?: string;
  message?: string;
  code?: string;
}

const mb = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

const EXPORT_TIP =
  "Reduce the model before export: hide furniture, entourage and site context you don't need, " +
  "lower render-mesh density (Rhino: Document Properties → Mesh → Jagged & faster), and keep textures at 2K or below.";

function parseBody(text: string | null | undefined): StorageErrorBody {
  if (!text) return {};
  try {
    const json = JSON.parse(text);
    return json && typeof json === "object" ? (json as StorageErrorBody) : {};
  } catch {
    return {};
  }
}

/** File too large for the server — shared by the pre-check and the 413 response. */
export function tooLargeError(bytes?: number): UploadErrorInfo {
  return {
    kind: "too-large",
    message: bytes
      ? `The model is ${mb(bytes)} after optimizing — the upload limit is ${STORAGE_MAX_UPLOAD_MB} MB.`
      : `The model is larger than the ${STORAGE_MAX_UPLOAD_MB} MB upload limit.`,
    tip: EXPORT_TIP,
    detail: `413 EntityTooLarge${bytes ? ` · ${bytes} bytes` : ""}`,
  };
}

/**
 * Classify a failed Storage upload.
 * @param httpStatus  XHR status (0 = network failure / blocked)
 * @param responseText raw response body
 * @param bytes size of the file that was sent (for the message)
 */
export function describeUploadError(
  httpStatus: number,
  responseText?: string | null,
  bytes?: number,
): UploadErrorInfo {
  const body = parseBody(responseText);
  // The meaningful status lives in the body; fall back to the HTTP status.
  const status = Number(body.statusCode ?? httpStatus) || httpStatus;
  const text = `${body.error ?? ""} ${body.message ?? ""} ${body.code ?? ""}`.toLowerCase();
  const detail = [`HTTP ${httpStatus}`, body.statusCode && `storage ${body.statusCode}`, body.error, body.message]
    .filter(Boolean)
    .join(" · ");

  const info = (kind: UploadErrorKind, message: string, tip: string): UploadErrorInfo => ({
    kind,
    message,
    tip,
    detail,
  });

  if (httpStatus === 0) {
    return info(
      "network",
      "The connection dropped during the upload.",
      "Check your internet connection and try again. Large files upload best on a stable network (not a phone hotspot).",
    );
  }

  if (status === 413 || text.includes("too large") || text.includes("exceeded the maximum")) {
    return { ...tooLargeError(bytes), detail };
  }

  if (status === 401 || text.includes("jwt") || text.includes("token") || text.includes("unauthorized")) {
    return info(
      "auth",
      "Your session has expired.",
      "Sign out and sign in again, then retry the upload. Your project details are saved.",
    );
  }

  if (status === 403 || text.includes("row-level security") || text.includes("policy")) {
    return info(
      "permission",
      "You don't have permission to upload to this project.",
      "Make sure you're signed in with the account that created the project. If it persists, contact support.",
    );
  }

  if (status === 409 || text.includes("already exists") || text.includes("duplicate")) {
    return info("conflict", "A file with this name is already being uploaded.", "Wait a moment and retry.");
  }

  if (status === 415 || text.includes("mime") || text.includes("content type")) {
    return info(
      "file-type",
      "The server didn't accept this file type.",
      "Export as binary glTF (.glb), not .gltf with separate files. In Rhino: File → Export → .glb.",
    );
  }

  if (text.includes("invalid key") || text.includes("invalid path") || text.includes("invalidkey")) {
    return info(
      "bad-name",
      "The file name contains characters the server can't store.",
      "Rename the file using only letters, numbers, dashes and underscores (e.g. office_v2.glb) and upload again.",
    );
  }

  if (status === 429 || text.includes("rate limit") || text.includes("too many")) {
    return info("rate-limit", "Too many uploads in a short time.", "Wait a minute and try again.");
  }

  if (status >= 500) {
    return info(
      "server",
      "The storage server had a problem.",
      "This is on our side, not your file. Try again in a few minutes.",
    );
  }

  return info(
    "unknown",
    body.message ? `Upload rejected: ${body.message}` : `Upload failed (status ${status}).`,
    "Try again. If it keeps failing, send us the details below.",
  );
}

/** Error carrying classified upload info through a Promise rejection. */
export class UploadError extends Error {
  constructor(public readonly info: UploadErrorInfo) {
    super(info.message);
    this.name = "UploadError";
  }
}
