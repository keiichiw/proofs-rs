import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

for (const denied of [false, true]) {
  test(`badge Markdown copy ${denied ? "selects the code when clipboard is unavailable" : "writes exact Markdown to clipboard"}`, async () => {
    const markdown =
      "[![proofs.rs](https://img.shields.io/endpoint?url=example)](https://proofs.rs/crate/sample?version=1.0.0)";
    const dom = new JSDOM(
      '<details><button data-copy-badge>Copy Markdown</button><span role="status" data-copy-status></span><pre><code></code></pre></details>',
      {
        url: "https://proofs.rs/crate/sample",
        runScripts: "outside-only",
      },
    );
    const { window } = dom;
    const code = window.document.querySelector("code")!;
    code.textContent = markdown;
    let copied = "";
    Object.defineProperty(window.navigator, "clipboard", {
      value: {
        async writeText(text: string) {
          if (denied) throw new Error("Denied");
          copied = text;
        },
      },
    });
    window.eval(
      readFileSync(new URL("../public/site.js", import.meta.url), "utf8"),
    );
    window.document.querySelector<HTMLButtonElement>("button")!.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    if (denied) {
      assert.equal(window.getSelection()!.toString(), markdown);
      assert.match(
        window.document.querySelector('[role="status"]')!.textContent!,
        /Selected/,
      );
    } else {
      assert.equal(copied, markdown);
      assert.match(
        window.document.querySelector('[role="status"]')!.textContent!,
        /Copied/,
      );
    }
    window.close();
  });
}
