import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFile, readdir } from "node:fs/promises";
import { createInterface } from "node:readline";

test(
  "packaged preview serves production fonts intact with licenses and a local-only font policy",
  { timeout: 15_000 },
  async () => {
    const child = spawn(
      process.execPath,
      [new URL("../cli/preview/server.cjs", import.meta.url).pathname],
      { stdio: ["pipe", "pipe", "inherit"] },
    );
    const closed = once(child, "exit");
    const lines = createInterface({ input: child.stdout });
    try {
      const [line] = await once(lines, "line");
      const ready = JSON.parse(line);
      assert.equal(ready.type, "ready");
      const origin = new URL(ready.url).origin;
      const css = await fetch(origin + "/fonts.css");
      assert.equal(css.status, 200);
      assert.match(
        css.headers.get("Content-Security-Policy")!,
        /(?:^|; )font-src 'self';/,
      );
      assert.equal(
        await css.text(),
        await readFile(new URL("../public/fonts.css", import.meta.url), "utf8"),
      );
      const directory = new URL("../public/fonts/", import.meta.url);
      const notices = await readFile(
        new URL("../cli/preview/THIRD_PARTY_NOTICES.txt", import.meta.url),
        "utf8",
      );
      for (const name of await readdir(directory)) {
        const expected = await readFile(new URL(name, directory));
        const response = await fetch(origin + "/fonts/" + name);
        assert.equal(response.status, 200, name);
        assert.equal(
          response.headers.get("Content-Type"),
          name.endsWith(".woff2") ? "font/woff2" : "text/plain; charset=utf-8",
        );
        assert.deepEqual(
          Buffer.from(await response.arrayBuffer()),
          expected,
          name,
        );
        if (name.includes("LICENSE"))
          assert(notices.includes(expected.toString().trim()), name);
        const head = await fetch(origin + "/fonts/" + name, { method: "HEAD" });
        assert.equal(head.status, 200);
        assert.equal((await head.arrayBuffer()).byteLength, 0);
      }
      assert.equal((await fetch(origin + "/fonts/missing.woff2")).status, 404);
    } finally {
      child.stdin.end();
      await closed;
      lines.close();
    }
  },
);
