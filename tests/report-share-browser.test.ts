import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { reportShare } from "../web/report-share";

for (const canCopy of [true, false]) {
  test(`Bluesky recovery preserves the post when clipboard ${canCopy ? "works" : "fails"}`, async () => {
    const title = 'Report </textarea><script>alert("x")</script> & 日本語';
    const url = "https://proofs.rs/report/9?v=2";
    const dom = new JSDOM(reportShare(title, url, false), {
      url,
      runScripts: "outside-only",
    });
    const { window } = dom;
    const doc = window.document;
    let copied: string | undefined;
    Object.defineProperty(window.navigator, "clipboard", {
      value: {
        async writeText(text: string) {
          if (!canCopy) throw new Error("Permission denied");
          copied = text;
        },
      },
    });
    window.eval(
      readFileSync(new URL("../public/site.js", import.meta.url), "utf8"),
    );
    const help = doc.querySelector<HTMLElement>("[data-share-help]")!;
    assert.equal(help.hidden, true);
    const link = doc.querySelector<HTMLAnchorElement>("[data-share-bluesky]")!;
    // Prevent jsdom navigation while verifying that our handler preserves the link.
    let prevented = true;
    link.addEventListener("click", (event) => {
      prevented = event.defaultPrevented;
      event.preventDefault();
    });
    link.click();
    assert.equal(prevented, false);
    assert.equal(link.target, "_blank");
    assert.equal(help.hidden, false);
    const post = `${title}\n${url}`;
    assert.equal(new URL(link.href).searchParams.get("text"), post);
    assert.equal(doc.querySelector("textarea")!.value, post);
    assert.equal(doc.querySelector("script"), null);
    doc.querySelector<HTMLButtonElement>("[data-copy-share]")!.click();
    await new Promise((resolve) => setImmediate(resolve));
    const manual = doc.querySelector<HTMLElement>("[data-share-manual]")!;
    if (canCopy) {
      assert.equal(copied, post);
      assert.equal(manual.hidden, true);
      assert.equal(doc.querySelector("[role=status]")!.textContent, " Copied");
    } else {
      assert.equal(manual.hidden, false);
      const text = doc.querySelector("textarea")!;
      assert.equal(doc.activeElement, text);
      assert.equal(text.selectionStart, 0);
      assert.equal(text.selectionEnd, post.length);
    }
    dom.window.close();
  });
}
