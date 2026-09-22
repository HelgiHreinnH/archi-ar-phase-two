// Audit L-1 (May 2026): use the production custom domain.
const PUBLISHED_APP_URL = "https://designingforusers.com";

/**
 * Origins that must NOT be baked into a shared QR code.
 * Netlify serves previews on *.netlify.app (deploy-preview-N--site, branch--site);
 * a QR generated there has to point at production, not at a preview that expires.
 */
function isPreviewOrigin(origin: string) {
  return (
    origin.includes(".netlify.app") ||
    origin.includes("localhost") ||
    origin.includes("127.0.0.1")
  );
}

export function getPublicAppUrl() {
  if (typeof window === "undefined") return PUBLISHED_APP_URL;

  const { origin } = window.location;
  return isPreviewOrigin(origin) ? PUBLISHED_APP_URL : origin;
}

export function buildPublicExperienceUrl(shareId: string) {
  return `${getPublicAppUrl()}/view/${shareId}`;
}
