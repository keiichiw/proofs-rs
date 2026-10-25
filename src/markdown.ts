import MarkdownIt from "markdown-it";
import sanitizeHtml from "sanitize-html";

const markdown = new MarkdownIt({
  html: false,
  breaks: true,
  linkify: false,
}).disable("image");

/** Render untrusted prose below the containing page or preset section heading. */
export function renderMarkdown(source: string, parentLevel: 1 | 2 | 3): string {
  const tokens = markdown.parse(source, {});
  for (const token of tokens) {
    if (token.type === "heading_open" || token.type === "heading_close") {
      token.tag = `h${Math.min(6, Number(token.tag.slice(1)) + parentLevel)}`;
    }
  }
  // Keep this allowlist independent of parser defaults and future extensions.
  return sanitizeHtml(markdown.renderer.render(tokens, markdown.options, {}), {
    allowedTags: [
      "p",
      "br",
      "hr",
      "h2",
      "h3",
      "h4",
      "h5",
      "h6",
      "strong",
      "em",
      "s",
      "blockquote",
      "ul",
      "ol",
      "li",
      "a",
      "pre",
      "code",
      "table",
      "thead",
      "tbody",
      "tr",
      "th",
      "td",
    ],
    allowedAttributes: { a: ["href", "title"], ol: ["start"] },
    allowedSchemes: ["https", "http", "mailto"],
    allowProtocolRelative: false,
    parseStyleAttributes: false,
  }).trim();
}
