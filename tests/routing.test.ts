import { test } from "node:test";
import assert from "node:assert/strict";
import { app } from "../src/worker";
import type { Env } from "../src/core";

test("page CSP permits Cloudflare Web Analytics without broad script permissions", async () => {
  const env = {
    ENVIRONMENT: "production",
    APP_ORIGIN: "https://example.test",
  } as unknown as Env;
  for (const path of ["/terms", "/api/docs"]) {
    const response = await app.request("https://example.test" + path, {}, env);
    assert.equal(response.status, 200);
    const directives = new Map(
      response.headers
        .get("content-security-policy")!
        .split(";")
        .map((part) => {
          const [name, ...sources] = part.trim().split(/\s+/);
          return [name, sources] as const;
        }),
    );
    const scripts = directives.get("script-src")!;
    assert.ok(scripts.includes("https://static.cloudflareinsights.com"));
    assert.deepEqual(directives.get("connect-src"), [
      "'self'",
      "https://cloudflareinsights.com",
    ]);
    assert.deepEqual(
      scripts.filter((source) => !source.startsWith("'nonce-")),
      path === "/api/docs"
        ? [
            "'self'",
            "https://cdn.jsdelivr.net",
            "https://static.cloudflareinsights.com",
          ]
        : ["'self'", "https://static.cloudflareinsights.com"],
    );
  }
});

test("static assets, Book and JSON API do not enter HTML routing", async () => {
  const fetched: string[] = [];
  const env = {
    ENVIRONMENT: "production",
    APP_ORIGIN: "https://example.test",
    ASSETS: {
      fetch: async (request: Request) => {
        fetched.push(new URL(request.url).pathname);
        return new Response("asset");
      },
    },
  } as unknown as Env;
  for (const path of [
    "/style.css",
    "/site.js",
    "/book/",
    "/book/account.js",
    "/missing.svg",
  ]) {
    await app.request("https://example.test" + path, {}, env);
    assert.equal(fetched.at(-1), path);
  }
  const count = fetched.length;
  const response = await app.request(
    "https://example.test/api/v1/unknown",
    {},
    env,
  );
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: "not_found" });
  assert.equal(fetched.length, count);
  const legal = await app.request("https://example.test/terms", {}, env);
  assert.equal(legal.status, 200);
  assert.match(await legal.text(), /<h1>Terms/);
  assert.equal(fetched.length, count);
});
