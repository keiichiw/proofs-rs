import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { pageLayout } from "../web/page-layout";

const publicDir = new URL("../public/", import.meta.url);
const linked = (html: string) => {
  const d = new JSDOM(html).window.document;
  return [
    ...[...d.querySelectorAll<HTMLLinkElement>("link[rel=stylesheet]")].map(
      (l) => l.getAttribute("href")!,
    ),
    ...[...d.querySelectorAll("script[src]")].map((s) =>
      s.getAttribute("src")!,
    ),
  ];
};

test("page shells link only assets that exist in public/", () => {
  const site = linked(pageLayout("t", "", "", null));
  assert(site.includes("/fonts.css"));
  for (const path of site)
    assert(existsSync(new URL("." + path, publicDir)), `${path} is missing`);
  // The CLI preview CSP has no font-src and the bundle embeds no fonts.
  const preview = linked(pageLayout("t", "", "", null, undefined, true));
  assert(!preview.includes("/fonts.css"));
  assert.deepEqual(
    preview,
    site.filter((path) => path !== "/fonts.css"),
  );
});

test("stylesheet url() references resolve to files in public/", () => {
  for (const name of readdirSync(publicDir).filter((n) => n.endsWith(".css")))
    for (const [, path] of readFileSync(new URL(name, publicDir), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .matchAll(/url\("?(\/[^")]+)"?\)/g))
      assert(existsSync(new URL("." + path, publicDir)), `${name}: ${path}`);
});
