import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { JSDOM } from "jsdom";
import { buildBookAssets, buildDemoBook } from "../demo/book/build";
import { mdbookAvailable } from "../scripts/build-book.mjs";
import { root } from "../scripts/demo";

test("Docs fixture shares Book assets, nested chapters and accessible persistent sidebar", async () => {
  const dir = await mkdtemp(resolve(tmpdir(), "docs-fixture-"));
  try {
    await buildDemoBook(root, dir);
    const html = await readFile(resolve(dir, "book/aeneas.html"), "utf8");
    assert.doesNotMatch(html, /<script>([\s\S]*?)<\/script>|\sstyle=/);
    const dom = new JSDOM(html, {
      url: "http://localhost/book/aeneas.html",
      runScripts: "outside-only",
    });
    const { document } = dom.window;
    assert.ok(
      document.querySelector(
        "#body-container > #sidebar-toggle-anchor ~ #sidebar ~ .page-wrapper .page > .proofs-site-header",
      ),
    );
    assert.ok(
      document.querySelector(
        '.chapter .section a[aria-current="page"][href="/book/aeneas.html"]',
      ),
    );
    assert.ok(document.querySelector(".content main h1"));
    for (const link of document.querySelectorAll('a[href^="/book/"]')) {
      const path = link.getAttribute("href")!.split("#")[0];
      await readFile(
        resolve(dir, path.slice(1) + (path.endsWith("/") ? "index.html" : "")),
      );
    }
    assert.equal(
      await readFile(resolve(dir, "book/theme/site-header.css"), "utf8"),
      await readFile(resolve(root, "book/theme/site-header.css"), "utf8"),
    );
    assert.ok(
      document.querySelector("li.chapter-item.expanded + li > ol.section"),
    );
    assert.equal(document.querySelectorAll("#sidebar ol.chapter").length, 1);
    assert.ok(document.querySelector("#sidebar ol.chapter > li.part-title"));
    const script = await readFile(resolve(dir, "book/demo-book.js"), "utf8");
    // A narrow first visit starts closed; wide screens are covered below.
    Object.defineProperty(dom.window, "innerWidth", { value: 800 });
    dom.window.eval(script);
    assert.ok(document.documentElement.classList.contains("js"));
    document.dispatchEvent(new dom.window.Event("DOMContentLoaded"));
    const button = document.getElementById("sidebar-toggle")!;
    const sidebar = document.getElementById("sidebar")!;
    assert.equal(sidebar.getAttribute("aria-hidden"), "true");
    button.click();
    assert.equal(button.getAttribute("aria-expanded"), "true");
    assert.equal(sidebar.getAttribute("aria-hidden"), "false");
    assert.equal(dom.window.localStorage.getItem("mdbook-sidebar"), "visible");
    document.dispatchEvent(
      new dom.window.KeyboardEvent("keydown", { key: "Escape" }),
    );
    assert.equal(button.getAttribute("aria-expanded"), "false");
    assert.equal(document.activeElement, button);
    dom.window.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// Exercise the real Book initializer as well as the standalone demo initializer.
test("Book and demo open on wide screens and honor saved sidebar state even without storage", async () => {
  const header = await readFile(resolve(root, "book/theme/header.hbs"), "utf8");
  const scripts = [
    header.match(/<script>([\s\S]*?)<\/script>/)![1],
    await readFile(resolve(root, "demo/book/demo-book.js"), "utf8"),
  ];
  for (const script of scripts) {
    for (const [width, saved] of [1280, 600].flatMap((width) =>
      [null, "visible", "hidden", "invalid", "blocked"].map(
        (saved) => [width, saved] as const,
      ),
    )) {
      const dom = new JSDOM(
        '<!doctype html><html class="sidebar-visible"><body><input id="sidebar-toggle-anchor" type="checkbox" checked><nav id="sidebar"></nav><button id="sidebar-toggle"></button></body></html>',
        { url: "http://localhost/book/", runScripts: "outside-only" },
      );
      Object.defineProperty(dom.window, "innerWidth", { value: width });
      if (saved === "blocked")
        Object.defineProperty(dom.window, "localStorage", {
          get() {
            throw new Error("Storage blocked");
          },
        });
      else if (saved) dom.window.localStorage.setItem("mdbook-sidebar", saved);
      dom.window.eval(script);
      const expected =
        saved === "visible" ||
        (saved !== "hidden" && saved !== "visible" && width >= 1080);
      assert.equal(
        dom.window.document.documentElement.classList.contains(
          "sidebar-visible",
        ),
        expected,
      );
      assert.equal(
        dom.window.document.documentElement.classList.contains(
          "sidebar-hidden",
        ),
        !expected,
      );
      assert.equal(
        (
          dom.window.document.getElementById(
            "sidebar-toggle-anchor",
          ) as HTMLInputElement
        ).checked,
        expected,
      );
      dom.window.close();
    }
  }
});

test("Docs fall back to the fixture without mdBook and drop a stale real build", async () => {
  const dir = await mkdtemp(resolve(tmpdir(), "docs-fallback-"));
  try {
    await mkdir(resolve(dir, "book"), { recursive: true });
    await writeFile(resolve(dir, "book/book.js"), "");
    await writeFile(resolve(dir, "book/searchindex.js"), "");
    assert.equal(await buildBookAssets(root, dir, false), "fixture");
    assert.ok(!existsSync(resolve(dir, "book/book.js")));
    assert.ok(!existsSync(resolve(dir, "book/searchindex.js")));
    assert.ok(existsSync(resolve(dir, "book/demo-book.js")));
    assert.ok(existsSync(resolve(dir, "book/index.html")));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test(
  "Docs serve the real CSP-compatible mdBook build when the pinned version is installed",
  { skip: !mdbookAvailable() && "mdBook 0.4.45 is not installed" },
  async () => {
    const dir = await mkdtemp(resolve(tmpdir(), "docs-mdbook-"));
    try {
      assert.equal(await buildBookAssets(root, dir), "mdbook");
      const html = await readFile(resolve(dir, "book/index.html"), "utf8");
      assert.doesNotMatch(html, /<script>([\s\S]*?)<\/script>|\sstyle=/);
      assert.match(html, /proofs-site-header/);
      assert.ok(existsSync(resolve(dir, "book/book.js")));
      assert.ok(!existsSync(resolve(dir, "book/demo-book.js")));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
);
