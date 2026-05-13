// Audit L-1 (May 2026): use the production custom domain.
const PUBLISHED_APP_URL = "https://designingforusers.com";

function isPreviewOrigin(origin: string) {
  return (
    origin.includes(".lovableproject.com") ||
    origin.includes("id-preview--") ||
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