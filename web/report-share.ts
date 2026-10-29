/** Direct posting links with a local recovery copy for Bluesky sign-in. */
export function reportShare(
  title: string,
  url: string,
  withdrawn: boolean,
): string {
  if (withdrawn) return "";
  const chars = Array.from(title);
  const shortened =
    chars.length > 150 ? chars.slice(0, 149).join("") + "…" : title;
  const text = shortened;
  const x = `https://x.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;
  const bluesky = `https://bsky.app/intent/compose?text=${encodeURIComponent(`${text}\n${url}`)}`;
  const attr = (value: string) =>
    value
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  return `<div data-report-share><nav class="report-share" aria-label="Share report"><a target="_blank" rel="noopener noreferrer" href="${attr(x)}"><img src="/social/x.svg" alt="" aria-hidden="true">X</a><a data-share-bluesky target="_blank" rel="noopener noreferrer" href="${attr(bluesky)}"><img src="/social/bluesky.svg" alt="" aria-hidden="true">Bluesky</a></nav><div class="report-share-help" data-share-help hidden><p>If signing in clears your post, return here and open Bluesky again, or copy the post and paste it there.</p><button type="button" data-copy-share>Copy post</button><span role="status" data-share-status></span><label data-share-manual hidden>Post text<textarea readonly rows="4">${attr(`${text}\n${url}`)}</textarea></label></div></div>`;
}
