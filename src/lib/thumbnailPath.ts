/**
 * Storage path (bucket: project-assets) of a project's preview image.
 *
 * "-v2": stills are rendered with textures since 16 Nov 2026. The new name
 * makes every existing project render a fresh one the next time it is shown
 * (ModelStill builds a missing image from the stored model).
 */
export function thumbnailPath(projectId: string): string {
  return `${projectId}/thumbnail-v2.jpg`;
}

/** The untextured still from before 16 Nov 2026; removed once a new one exists. */
export function legacyThumbnailPath(projectId: string): string {
  return `${projectId}/thumbnail.jpg`;
}
