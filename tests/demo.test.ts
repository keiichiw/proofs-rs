import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  rm,
  readFile,
  readdir,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createServer } from "node:net";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import {
  prepareDemo,
  syncAssets,
  withDemoLock,
  wrangler,
  root,
  config,
} from "../scripts/demo";
import { demoIDs as ids, demoScenarios } from "../demo/scenarios";
import { dependencyCatalog } from "../src/dependencies";
import { mdbookAvailable } from "../scripts/build-book.mjs";
import type { Env } from "../src/core";
import { app } from "../src/worker";

type Finding = {
  title: string;
  body: string;
  edit_version: number;
  apis: { id: string }[];
};
const readJSON = <T>(response: Response) => response.json() as Promise<T>;

test("asset sync updates the served directory in place", async () => {
  const dir = await mkdtemp(resolve(tmpdir(), "demo-assets-"));
  const from = resolve(dir, "public");
  const to = resolve(dir, "served");
  try {
    await mkdir(resolve(from, "fonts"), { recursive: true });
    await writeFile(resolve(from, "theme-a.css"), "a{}");
    await writeFile(resolve(from, "fonts", "Face.woff2"), "font");
    await mkdir(resolve(to, "old"), { recursive: true });
    await writeFile(resolve(to, "stale.css"), "x{}");
    const before = (await stat(to)).ino;
    await syncAssets(from, to);
    await writeFile(resolve(from, "theme-a.css"), "b{}");
    await syncAssets(from, to);
    assert.equal((await stat(to)).ino, before);
    assert.deepEqual((await readdir(to)).sort(), ["fonts", "theme-a.css"]);
    assert.equal(await readFile(resolve(to, "theme-a.css"), "utf8"), "b{}");
    assert.equal(
      await readFile(resolve(to, "fonts", "Face.woff2"), "utf8"),
      "font",
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("offline dependencies do not fall back to the network", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    throw new Error("Network unavailable");
  };
  try {
    assert.equal(
      await dependencyCatalog(
        {
          EXTERNAL_FETCH_DISABLED: "true",
          ARCHIVE: { get: async () => null },
        } as unknown as Env,
        "missing-demo",
        "1.0.0",
      ),
      null,
    );
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = original;
  }
});

test("production bundle excludes demo authentication and fixture modules", async () => {
  const result = await build({
    entryPoints: [resolve(root, "src/worker.ts")],
    bundle: true,
    write: false,
    metafile: true,
    platform: "browser",
    format: "esm",
    external: ["node:*", "cloudflare:*", "*.wasm"],
  });
  assert.ok(
    !Object.keys(result.metafile!.inputs).some((path) =>
      /(^|\/)demo\//.test(path),
    ),
  );
  assert.ok(!result.outputFiles[0].text.includes("/__demo/session"));
  const local = JSON.parse(
    await readFile(resolve(root, "wrangler.local.json"), "utf8"),
  );
  assert.equal(local.main, "demo/worker.ts");
  assert.equal(local.queues, undefined);
  assert.equal(local.triggers, undefined);
  assert.ok(!JSON.stringify(local).includes('"remote":true'));
  const env = {
    ENVIRONMENT: "production",
    ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
  } as unknown as Env;
  assert.equal(
    (await app.request("https://proofs.rs/__demo", {}, env)).status,
    404,
  );
  assert.equal(
    (
      await app.request(
        "https://proofs.rs/__demo/session",
        { method: "GET" },
        env,
      )
    ).status,
    404,
  );
});

test(
  "real local Worker: scenarios, sessions, Finding edits, persistence and reset",
  { timeout: 180_000 },
  async () => {
    await mkdir(resolve(root, ".wrangler"), { recursive: true });
    const path = await mkdtemp(resolve(root, ".wrangler/demo-test-"));
    const socket = createServer().listen(0, "127.0.0.1");
    await once(socket, "listening");
    const port = (socket.address() as import("node:net").AddressInfo).port;
    await new Promise<void>((done) => socket.close(() => done()));
    const origin = `http://127.0.0.1:${port}`;
    const offlineWorker = resolve(path, "offline-worker.mjs");
    const compileOffline = () =>
      build({
        entryPoints: [resolve(root, "demo/worker.ts")],
        outfile: offlineWorker,
        bundle: true,
        platform: "browser",
        format: "esm",
        external: ["node:*", "cloudflare:*"],
        loader: { ".wasm": "copy" },
        banner: {
          js: 'globalThis.fetch = async () => { throw new Error("External network disabled by demo integration test"); };',
        },
      });
    let child: ReturnType<typeof wrangler> | undefined;
    let output = "";
    const start = async () => {
      child = wrangler(
        [
          "dev",
          offlineWorker,
          "--no-bundle",
          "--local",
          "--persist-to",
          path,
          "--ip",
          "127.0.0.1",
          "--port",
          String(port),
          "--var",
          `APP_ORIGIN:${origin}`,
        ],
        "pipe",
      );
      child.stdout?.on("data", (data) => {
        output = (output + data).slice(-16000);
      });
      child.stderr?.on("data", (data) => {
        output = (output + data).slice(-16000);
      });
      for (let i = 0; i < 150; i++) {
        if (child.exitCode !== null) throw new Error(output);
        try {
          const r = await fetch(origin + "/api/v1/health");
          if (r.ok) {
            await r.text();
            return;
          }
        } catch {}
        await delay(100);
      }
      throw new Error("Worker did not start:\n" + output);
    };
    const stop = async () => {
      if (child && child.exitCode === null && child.signalCode === null) {
        const exited = once(child, "exit");
        child.kill("SIGTERM");
        await exited;
      }
      child = undefined;
    };
    let cookie = "",
      csrf = "";
    const request = async (path: string, method = "GET", body?: unknown) =>
      fetch(origin + path, {
        method,
        redirect: "manual",
        headers: {
          Cookie: cookie,
          Origin: origin,
          "Content-Type": "application/json",
          "X-CSRF-Token": csrf,
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    const switchUser = async (user: string) => {
      const response = await fetch(origin + "/__demo/session", {
        method: "POST",
        redirect: "manual",
        headers: { Origin: origin, Cookie: cookie },
        body: new URLSearchParams({ user, return_to: "/__demo" }),
      });
      assert.equal(response.status, 303, await response.text());
      cookie = response.headers.getSetCookie().at(-1)!.split(";")[0];
      const me = await readJSON<{
        user: { username: string } | null;
        csrf?: string;
      }>(await request("/api/v1/me"));
      assert.equal(
        me.user?.username || null,
        user ? (user === "author" ? "demo_mira" : "demo_nora") : null,
      );
      csrf = me.csrf || "";
      return me;
    };
    try {
      await withDemoLock(path, async () => {
        await assert.rejects(
          withDemoLock(path, async () => {}),
          /running/,
        );
        await prepareDemo(path);
        const { getPlatformProxy } = await import("wrangler");
        const { seedDemo } = await import("../demo/seed");
        const proxy = await getPlatformProxy<Env>({
          configPath: config,
          persist: { path: resolve(path, "v3") },
          remoteBindings: false,
          envFiles: [],
        });
        try {
          const marker = await proxy.env.DB.prepare(
            "SELECT value FROM settings WHERE key='local_demo_seed'",
          ).first<{ value: string }>();
          const count = await proxy.env.DB.prepare(
            "SELECT COUNT(*) n FROM reports",
          ).first<{ n: number }>();
          await proxy.env.ARCHIVE.delete(
            "staging-layout-v1/c9769922-6967-59a1-93c0-2a1fb7e1e5bf.sarif.json",
          );
          await proxy.env.DB.prepare(
            "UPDATE settings SET value=? WHERE key='local_demo_seed'",
          )
            .bind(`pending:${marker!.value}`)
            .run();
          assert.equal(await seedDemo(proxy.env), true);
          assert.deepEqual(
            await proxy.env.DB.prepare(
              "SELECT COUNT(*) n FROM reports",
            ).first(),
            count,
          );
          assert.ok(
            await proxy.env.ARCHIVE.head(
              "staging-layout-v1/c9769922-6967-59a1-93c0-2a1fb7e1e5bf.sarif.json",
            ),
          );
          await proxy.env.DB.prepare(
            "UPDATE settings SET value='different-fixture-version' WHERE key='local_demo_seed'",
          ).run();
          await assert.rejects(seedDemo(proxy.env), /demo:reset/);
          await proxy.env.DB.prepare(
            "UPDATE settings SET value=? WHERE key='local_demo_seed'",
          )
            .bind(marker!.value)
            .run();
        } finally {
          await proxy.dispose();
        }
        await compileOffline();
      });
      await start();
      const image = await fetch(origin + `/og/report/${ids.report}/1.png`);
      await delay(300);
      assert.equal(image.status, 200, output);
      assert.equal(image.headers.get("Content-Type"), "image/png");
      const png = Buffer.from(await image.arrayBuffer());
      assert.equal(png.readUInt32BE(16), 1200);
      assert.equal(png.readUInt32BE(20), 630);
      for (const page of [
        "/",
        "/crate/findings-demo",
        `/claim/${ids.claim}`,
        `/finding/${ids.openFinding}`,
        "/reports",
      ]) {
        const response = await fetch(origin + page);
        assert.equal(response.status, 200, page);
        const document = new JSDOM(await response.text()).window.document;
        const imageURL = document
          .querySelector('meta[property="og:image"]')
          ?.getAttribute("content");
        assert(imageURL, page);
        const imageResponse = await fetch(imageURL);
        assert.equal(imageResponse.status, 200, page);
        assert.equal(imageResponse.headers.get("Content-Type"), "image/png");
        await imageResponse.arrayBuffer();
      }
      for (const page of [
        "/account",
        "/settings",
        "/claim/missing",
        "/og/page.png",
      ]) {
        assert.equal(
          (
            await fetch(
              origin + "/og/page.png?path=" + encodeURIComponent(page),
            )
          ).status,
          404,
          page,
        );
      }

      const docs = await request("/book/");
      assert.equal(docs.status, 200);
      const docsHTML = await docs.text();
      assert.match(docsHTML, /id="sidebar"/);
      assert.match(
        docs.headers.get("content-security-policy") || "",
        /script-src 'self'/,
      );
      assert.equal((await request("/book/css/chrome.css")).status, 200);
      // The demo serves the real Book when the pinned mdBook is installed.
      if (mdbookAvailable()) {
        assert.match(docsHTML, /proofs-site-header/);
        assert.equal((await request("/book/book.js")).status, 200);
      } else {
        assert.match(docsHTML, /Docs layout demo/);
        assert.equal((await request("/book/demo-book.js")).status, 200);
      }

      assert.equal((await request("/__demo")).status, 200);
      for (const [, url] of demoScenarios.filter(
        ([, url]) => !url.startsWith("/my-"),
      )) {
        const r = await request(url);
        assert.equal(r.status, 200, `${url}: ${await r.text()}`);
      }
      const denied = await fetch(origin + "/__demo/session", {
        method: "POST",
        headers: { Origin: "https://evil.test" },
        body: new URLSearchParams({ user: "author" }),
      });
      assert.equal(denied.status, 403);
      assert.equal(
        (await request("/api/v1/publish/prepare", "POST", {})).status,
        503,
      );
      await switchUser("author");
      for (const [, url] of demoScenarios.filter(([, url]) =>
        url.startsWith("/my-"),
      )) {
        const response = await request(url);
        if (response.status === 302) {
          const redirected = await request(response.headers.get("location")!);
          assert.equal(redirected.status, 200, await redirected.text());
        } else
          assert.equal(
            response.status,
            200,
            `${url}: ${await response.text()}`,
          );
      }
      const findingPath = `/api/v1/findings/${ids.openFinding}`;
      const initial = await readJSON<Finding>(await request(findingPath));
      const edited = await request(findingPath, "PATCH", {
        edit_version: initial.edit_version,
        title: "Edited locally",
        body: "Local demo edit",
        validity: "confirmed",
        api_item_ids: [ids.bothAPI, ids.claimOnlyAPI],
      });
      assert.equal(edited.status, 200, await edited.text());
      const reportAPIs = new JSDOM(
        await (await request(`/report/${ids.report}`)).text(),
      );
      assert.equal(
        Array.from(
          reportAPIs.window.document.querySelectorAll(".report-api-claims"),
        ).filter((row) => row.textContent?.includes("Edited locally")).length,
        2,
      );
      const linked = await readJSON<Finding>(await request(findingPath));
      assert.deepEqual(
        linked.apis.map((a: { id: string }) => a.id).sort(),
        [ids.bothAPI, ids.claimOnlyAPI].sort(),
      );
      // Exercise the regular HTML form and CSRF path, as well as the JSON API.
      const html = new JSDOM(
        await (await request(`/finding/${ids.openFinding}?edit=1`)).text(),
      );
      const form = html.window.document.querySelector<HTMLFormElement>(
        'form[action="/_actions/edit-finding"]',
      );
      assert.ok(form);
      const formBody = new URLSearchParams();
      for (const [key, value] of new html.window.FormData(form))
        formBody.append(key, String(value));
      formBody.set("body", "Edited through the regular HTML form");
      const saved = await fetch(origin + "/_actions/edit-finding", {
        method: "POST",
        redirect: "manual",
        headers: { Cookie: cookie, Origin: origin },
        body: formBody,
      });
      assert.equal(saved.status, 303, await saved.text());
      assert.equal(
        (await readJSON<Finding>(await request(findingPath))).body,
        "Edited through the regular HTML form",
      );
      const comment = await request(
        `/api/v1/reports/${ids.report}/comments`,
        "POST",
        { revision_no: 2, body: "Local demo comment" },
      );
      assert.equal(comment.status, 201, await comment.text());
      const report = new JSDOM(
        await (await request(`/report/${ids.report}`)).text(),
      );
      assert.match(
        report.window.document.body.textContent!,
        /Synthetic discussion comment 55/,
      );
      const revision = await request(`/report/${ids.report}?v=1`);
      assert.equal(revision.status, 200);
      assert.match(await revision.text(), /initial revision/);
      const dashboard = new JSDOM(await (await request("/__demo")).text());
      const full = Array.from(dashboard.window.document.querySelectorAll("a"))
        .find((a) => a.textContent === "Layout · full")!
        .getAttribute("href")!;
      const fullHTML = await (await request(full)).text();
      assert.match(fullHTML, /Synthetic diagnostics/);
      const sarif = await request(
        "/api/v1/runs/c9769922-6967-59a1-93c0-2a1fb7e1e5bf/sarif",
      );
      assert.equal(sarif.status, 200);
      assert.equal(
        (await readJSON<{ version: string }>(sarif)).version,
        "2.1.0",
      );
      await switchUser("other");
      const activity = new JSDOM(await (await request("/account")).text());
      assert.ok(
        activity.window.document.querySelector('a[href*="comments_cursor="]'),
      );
      const updated = await readJSON<Finding>(await request(findingPath));
      assert.equal(
        (
          await request(findingPath, "PATCH", {
            edit_version: updated.edit_version,
            title: "Forbidden",
          })
        ).status,
        403,
      );
      await switchUser("");
      assert.equal(
        (
          await request(findingPath, "PATCH", {
            edit_version: updated.edit_version,
            title: "Forbidden",
          })
        ).status,
        401,
      );
      await stop();
      await prepareDemo(path);
      await compileOffline();
      await start();
      assert.equal(
        (await readJSON<Finding>(await request(findingPath))).title,
        "Edited locally",
      );
      await stop();
      await rm(path, { recursive: true, force: true });
      await prepareDemo(path);
      await compileOffline();
      await start();
      const restored = await readJSON<Finding>(await request(findingPath));
      assert.equal(restored.title, initial.title);
      assert.equal(restored.edit_version, 1);
    } catch (error) {
      console.error(output);
      throw error;
    } finally {
      await stop();
      await rm(path, { recursive: true, force: true });
    }
  },
);
