/** The default used by publication validation and the local preview. */
export function claimTitle(
  title: string,
  path: string,
  tool: string,
  version: string,
): string {
  return title.trim() || `Verification of ${path} (with ${tool} ${version})`;
}
