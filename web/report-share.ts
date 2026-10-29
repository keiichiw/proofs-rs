/** Links to the posting interfaces; no scripts or external trackers are needed. */
export function reportShare(
  title: string,
  url: string,
  withdrawn: boolean,
): string {
  if (withdrawn) return "";
  const chars = Array.from(title);
  const shortened =
    chars.length > 150 ? chars.slice(0, 149).join("") + "…" : title;
  const text = `${shortened} · proofs.rs`;
  const x = `https://x.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;
  const bluesky = `https://bsky.app/intent/compose?text=${encodeURIComponent(`${text}\n${url}`)}`;
  const attr = (value: string) =>
    value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  return `<nav class="report-share" aria-label="Share report"><a target="_blank" rel="noopener noreferrer" href="${attr(x)}"><img src="/social/x.svg" alt="" aria-hidden="true">X</a><a target="_blank" rel="noopener noreferrer" href="${attr(bluesky)}"><img src="/social/bluesky.svg" alt="" aria-hidden="true">Bluesky</a></nav>`;
}
