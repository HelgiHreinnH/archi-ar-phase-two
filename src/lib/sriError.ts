/**
 * Audit C-1 / L-5 (May 2026): Subresource Integrity error handling for the
 * MindAR CDN assets.
 *
 * When a `<script integrity>` or `<link rel="modulepreload" integrity>` hash
 * mismatches the bytes the browser fetched, the browser fires a generic
 * `error` event with no machine-readable distinction from a network failure.
 *
 * We disambiguate by retrying the URL with a plain fetch — if it succeeds,
 * the file is reachable and the failure was almost certainly an SRI mismatch
 * (CDN bumped a version, supply-chain compromise, or the pinned hash is stale).
 *
 * This lets us surface a precise, actionable error to the user instead of a
 * generic "camera failed" message.
 */

export class MindARSRIError extends Error {
  /** Which CDN URL failed integrity validation. */
  public readonly url: string;

  constructor(url: string, message?: string) {
    super(
      message ??
        "MindAR CDN integrity check failed. The file may have been updated upstream."
    );
    this.name = "MindARSRIError";
    this.url = url;
  }
}

/**
 * Probe a URL to decide whether a `<script>` / dynamic-import failure was
 * caused by an SRI mismatch (file reachable but rejected) or a network/CORS
 * problem (file not reachable).
 */
export async function isLikelySRIFailure(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: "GET",
      mode: "cors",
      cache: "no-cache",
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Returns true when the user has opted into a session that bypasses SRI
 * validation for MindAR assets (via the `?nosri=1` query param). This is
 * the recovery path the SRI-error UI offers to unblock end-users when our
 * pinned hash drifts from the current CDN bytes.
 */
export function sriBypassEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return new URLSearchParams(window.location.search).get("nosri") === "1";
  } catch {
    return false;
  }
}

/**
 * The MindAR runtime resolves two bare specifiers through the import map in
 * index.html. If either one 404s, our SPA returns index.html with status 200,
 * so the browser fails to parse it as a module and reports the *parent* import
 * as "failed to fetch" — which used to be misreported as an integrity failure.
 *
 * Returns the first dependency that is missing or served as HTML, or null when
 * they all look like real JavaScript modules.
 */
export async function findBrokenModuleDependency(urls: string[]): Promise<string | null> {
  for (const url of urls) {
    try {
      const res = await fetch(url, { method: "GET", cache: "no-cache" });
      const type = res.headers.get("content-type") ?? "";
      if (!res.ok || type.includes("text/html")) return url;
    } catch {
      return url;
    }
  }
  return null;
}

