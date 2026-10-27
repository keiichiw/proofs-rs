import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import MarkdownIt from "markdown-it";
import { JSDOM } from "jsdom";
import { buildBook, mdbookAvailable } from "../../scripts/build-book.mjs";

// Serve the real Book when the pinned mdBook is installed; otherwise keep the
// demo usable without Rust tooling by rendering the layout fixture below.
export async function buildBookAssets(
  root: string,
  assets: string,
  real = mdbookAvailable(),
): Promise<"mdbook" | "fixture"> {
  if (real) {
    buildBook(resolve(assets, "book"), "pipe");
    return "mdbook";
  }
  // Drop pages left by an earlier real build (book.js is mdBook-only); the
  // fixture otherwise updates its files in place.
  if (existsSync(resolve(assets, "book/book.js")))
    await rm(resolve(assets, "book"), { recursive: true, force: true });
  await buildDemoBook(root, assets);
  return "fixture";
}

// This is a layout fixture, not an alternative production documentation build.
export async function buildDemoBook(root: string, assets: string) {
  const output = resolve(assets, "book");
  await mkdir(output, { recursive: true });
  await cp(resolve(root, "demo/book/vendor"), resolve(output, "css"), {
    recursive: true,
  });
  await cp(resolve(root, "book/theme"), resolve(output, "theme"), {
    recursive: true,
  });
  for (const file of ["demo-book.js", "demo-book.css"]) {
    await cp(resolve(root, "demo/book", file), resolve(output, file));
  }
  const md = new MarkdownIt({ html: true });
  const summary = await readFile(resolve(root, "book/src/SUMMARY.md"), "utf8");
  const chapters = [
    ...summary.matchAll(/^\s*- \[([^\]]+)\]\(([^)]+)\.md\)/gm),
  ].map((m) => ({ title: m[1], name: m[2] }));
  const header = (
    await readFile(resolve(root, "book/theme/header.hbs"), "utf8")
  ).replace(/<script>[\s\S]*?<\/script>/g, "");
  for (const [index, chapter] of chapters.entries()) {
    const toc = new JSDOM(md.render(summary.replace(/^#.*\n/, ""))).window
      .document;
    for (const list of toc.querySelectorAll("ul")) {
      const ol = toc.createElement("ol");
      ol.className = list.parentElement === toc.body ? "chapter" : "section";
      for (const node of [...list.childNodes]) ol.appendChild(node);
      list.replaceWith(ol);
    }
    for (const li of toc.querySelectorAll("li"))
      li.className = "chapter-item expanded";
    // mdBook puts child lists in a sibling li; chapter-item itself is flex.
    for (const section of toc.querySelectorAll("ol.section")) {
      const parent = section.parentElement!;
      const container = toc.createElement("li");
      parent.parentNode!.insertBefore(container, parent.nextSibling);
      container.appendChild(section);
    }
    // mdBook renders SUMMARY part titles as items of one chapter list.
    const chapterList = toc.createElement("ol");
    chapterList.className = "chapter";
    for (const node of [...toc.body.children]) {
      if (node.tagName === "H1") {
        const title = toc.createElement("li");
        title.className = "part-title";
        title.textContent = node.textContent;
        chapterList.appendChild(title);
      } else
        for (const child of [...node.childNodes]) chapterList.appendChild(child);
    }
    toc.body.replaceChildren(chapterList);
    for (const a of toc.querySelectorAll("a")) {
      const href = a.getAttribute("href")!.replace(/\.md$/, ".html");
      a.setAttribute("href", `/book/${href}`);
      if (href === chapter.name + ".html") {
        a.className = "active";
        a.setAttribute("aria-current", "page");
      }
    }
    const content = new JSDOM(
      md.render(
        await readFile(resolve(root, "book/src", chapter.name + ".md"), "utf8"),
      ),
    ).window.document;
    const used = new Map<string, number>();
    for (const heading of content.querySelectorAll("h1,h2,h3,h4,h5,h6")) {
      const slug = heading
        .textContent!.toLowerCase()
        .replace(/[^\p{L}\p{N}_\-\s]/gu, "")
        .replace(/\s+/g, "-");
      const count = used.get(slug) || 0;
      used.set(slug, count + 1);
      heading.id ||= slug + (count ? `-${count}` : "");
    }
    for (const a of content.querySelectorAll("a[href]")) {
      const href = a.getAttribute("href")!;
      if (!/^[a-z]+:/i.test(href))
        a.setAttribute("href", href.replace(/\.md(?=#|$)/, ".html"));
    }
    for (const table of content.querySelectorAll("table")) {
      const wrapper = content.createElement("div");
      wrapper.className = "table-wrapper";
      table.replaceWith(wrapper);
      wrapper.appendChild(table);
    }
    const nav = (mobile: boolean) =>
      [
        index > 0
          ? [chapters[index - 1], "prev", "previous", "Previous chapter", "‹"]
          : null,
        index < chapters.length - 1
          ? [chapters[index + 1], "next", "next", "Next chapter", "›"]
          : null,
      ]
        .filter(Boolean)
        .map((item) => {
          const [target, rel, direction, label, icon] = item!;
          return `<a href="/book/${(target as typeof chapter).name}.html" rel="${rel}" class="${mobile ? "mobile-nav-chapters" : "nav-chapters"} ${direction}" aria-label="${label}">${icon}</a>`;
        })
        .join("");
    await writeFile(
      resolve(output, chapter.name + ".html"),
      `<!doctype html>
<html lang="en" class="light sidebar-visible" dir="ltr"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${md.utils.escapeHtml(chapter.title)} · proofs.rs Docs demo</title>
<link rel="stylesheet" href="/book/css/variables.css"><link rel="stylesheet" href="/book/css/general.css"><link rel="stylesheet" href="/book/css/chrome.css">
<link rel="stylesheet" href="/book/theme/site-header.css"><script src="/theme.js"></script><link rel="stylesheet" href="/fonts.css"><link rel="stylesheet" href="/theme-header.css"><link rel="stylesheet" href="/book/demo-book.css">
</head><body><div id="body-container">
<input type="checkbox" id="sidebar-toggle-anchor" class="hidden" checked>
<script src="/book/demo-book.js"></script>
<nav id="sidebar" class="sidebar" aria-label="Table of contents"><div class="sidebar-scrollbox">${toc.body.innerHTML}</div></nav>
<div id="page-wrapper" class="page-wrapper"><div class="page">${header}
<div id="menu-bar-hover-placeholder"></div><div id="menu-bar" class="menu-bar sticky"><div class="left-buttons"><button id="sidebar-toggle" class="icon-button" type="button" aria-label="Toggle Table of Contents" aria-controls="sidebar">☰</button></div><h1 class="menu-title">proofs.rs Book</h1></div>
<div id="content" class="content"><main><p class="demo-book-notice">Docs layout demo · <a href="/__demo">Scenarios</a></p>${content.body.innerHTML}</main><nav class="nav-wrapper" aria-label="Page navigation">${nav(true)}<div class="book-clear"></div></nav></div>
</div><nav class="nav-wide-wrapper" aria-label="Page navigation">${nav(false)}</nav></div></div>
<script src="/account-navigation.js"></script><script src="/book/theme/account.js"></script><script src="/book/theme/sidebar-state.js"></script>
</body></html>`,
    );
  }
}
