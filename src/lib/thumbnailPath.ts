/** Storage path (bucket: project-assets) of a project's preview image. */
export function thumbnailPath(projectId: string): string {
  return `${projectId}/thumbnail.jpg`;
}
