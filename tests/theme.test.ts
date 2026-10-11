import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

const script = readFileSync(
  new URL("../public/theme.js", import.meta.url),
  "utf8",
);
function preview(query = "", saved?: string, blocked = false) {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "https://example.test/crates" + query,
    runScripts: "outside-only",
  });
  if (saved) dom.window.sessionStorage.setItem("proofs-theme", saved);
  if (blocked)
    Object.defineProperty(dom.window, "sessionStorage", {
      get() {
        throw new Error("Storage blocked");
      },
    });
  dom.window.eval(script);
  return dom.window;
}
test("A is default; base persists across navigation and explicit A resets it", () => {
  assert.equal(preview().document.documentElement.dataset.theme, "a");
  const base = preview("?theme=base");
  assert.equal(base.document.documentElement.dataset.theme, "base");
  const saved = base.sessionStorage.getItem("proofs-theme")!;
  assert.equal(
    preview("?page=2", saved).document.documentElement.dataset.theme,
    "base",
  );
  const reset = preview("?theme=a", saved);
  assert.equal(reset.document.documentElement.dataset.theme, "a");
  assert.equal(reset.sessionStorage.getItem("proofs-theme"), "a");
  assert.equal(
    preview("?theme=invalid").document.documentElement.dataset.theme,
    "a",
  );
});
test("explicit theme selection works without browser storage", () => {
  assert.equal(
    preview("?theme=base", undefined, true).document.documentElement.dataset
      .theme,
    "base",
  );
  assert.equal(
    preview("", undefined, true).document.documentElement.dataset.theme,
    "a",
  );
});
