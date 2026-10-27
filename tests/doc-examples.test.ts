import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";

// Keep in step with the versions listed on https://proofs.rs/tool/kani:
// readers copy these examples, and publish rejects unregistered versions only
// after the run has finished.
const KANI_EXAMPLE_VERSION = "0.68.0";

const book = new URL("../book/src/", import.meta.url);
const sources = [
  ...readdirSync(book)
    .filter((name) => name.endsWith(".md"))
    .map((name) => new URL(name, book)),
  new URL("../cli/README.md", import.meta.url),
];

test("Kani examples in the Book and CLI README use one registered version", () => {
  const found: string[] = [];
  for (const file of sources) {
    const text = readFileSync(file, "utf8");
    for (const block of text.matchAll(/```(?:toml|sh)\n([\s\S]*?)```/g)) {
      if (!/name = "kani"|cargo kani|init --tool-version/.test(block[1]))
        continue;
      for (const m of block[1].matchAll(
        /(?:version = "|--tool-version )(\d+\.\d+\.\d+)/g,
      ))
        found.push(`${file.pathname.split("/").pop()}: ${m[1]}`);
    }
  }
  assert(found.length > 0, "no Kani version examples found");
  for (const entry of found)
    assert(entry.endsWith(KANI_EXAMPLE_VERSION), entry);
});
