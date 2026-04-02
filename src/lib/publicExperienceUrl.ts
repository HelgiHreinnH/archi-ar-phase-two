const PUBLISHED_APP_URL = "https://designingforusers.com";

function isPreviewOrigin(origin: string) {
  return origin.includes(".lovableproject.com") || origin.includes("id-preview--");
}

export function getPublicAppUrl() {
  if (typeof window === "undefined") return PUBLISHED_APP_URL;

  const { origin } = window.location;
  return isPreviewOrigin(origin) ? PUBLISHED_APP_URL : origin;
}

export function buildPublicExperienceUrl(shareId: string) {
  return `${getPublicAppUrl()}/view/${shareId}`;
}