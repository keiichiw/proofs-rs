import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { seoResponse } from "../src/seo.ts";
import { app } from "../src/worker";
import type { Env } from "../src/core";

function fixture() {
  const db = new DatabaseSync(":memory:");
  db.exec(
    [
      "CREATE TABLE reports(id INTEGER,release_id INTEGER,visibility TEXT,withdrawn_at TEXT);",
      "CREATE TABLE crates(id INTEGER,name TEXT);",
      "CREATE TABLE releases(id INTEGER,crate_id INTEGER,version TEXT);",
      "CREATE TABLE claims(id TEXT,report_id INTEGER,api_item_id TEXT);",
      "CREATE TABLE claim_revisions(claim_id TEXT,report_revision INTEGER);",
      "CREATE TABLE report_revisions(report_id INTEGER,revision_no INTEGER);",
      "CREATE TABLE tools(id TEXT,active INTEGER);",
      "INSERT INTO crates VALUES(1,'example');",
      "INSERT INTO releases VALUES(1,1,'1.0.0');",
      "INSERT INTO reports VALUES(1,1,'public',NULL),(2,1,'hidden',NULL),(3,1,'public','2026-01-01');",
      "INSERT INTO report_revisions VALUES(1,1),(1,2),(2,1),(3,1);",
      "INSERT INTO claims VALUES('current',1,'api-current'),('old',1,'api-old'),('hidden',2,'api-hidden'),('withdrawn',3,'api-withdrawn');",
      "INSERT INTO claim_revisions VALUES('current',2),('old',1),('hidden',1),('withdrawn',1);",
      "INSERT INTO tools VALUES('kani',1),('inactive',0);",
    ].join("\n"),
  );
  const env = {
    ENVIRONMENT: "production",
    APP_ORIGIN: "https://proofs.rs",
    DB: {
      prepare(sql: string) {
        const statement = db.prepare(sql);
        let bindings: any[] = [];
        return {
          bind(...values: any[]) {
            bindings = values;
            return this;
          },
          async first() {
            return statement.get(...bindings) || null;
          },
          async all() {
            return { results: statement.all(...bindings) };
          },
        };
      },
    },
  } as unknown as Env;
  return { db, env };
}
const urls = (xml: string) =>
  [...xml.matchAll(/<loc>(.*?)<\/loc>/g)].map((m) => m[1]);

test("sitemaps exclude hidden, withdrawn and superseded evidence", async () => {
  const { db, env } = fixture();
  try {
    assert.deepEqual(
      urls(await (await seoResponse(env, "/sitemap.xml"))!.text()),
      [
        "https://proofs.rs/sitemaps/pages.xml",
        "https://proofs.rs/sitemaps/records-1.xml",
      ],
    );
    const response = await seoResponse(env, "/sitemaps/records-1.xml");
    assert.equal(
      response!.headers.get("Content-Type"),
      "application/xml; charset=utf-8",
    );
    assert.equal(response!.headers.get("set-cookie"), null);
    assert.deepEqual(
      urls(await response!.text()).sort(),
      [
        "https://proofs.rs/api/api-current",
        "https://proofs.rs/claim/current",
        "https://proofs.rs/crate/example",
        "https://proofs.rs/crate/example?version=1.0.0",
        "https://proofs.rs/report/1",
        "https://proofs.rs/tool/kani",
      ].sort(),
    );
    for (const path of [
      "/sitemaps/records-2.xml",
      "/sitemaps/records-0.xml",
      "/sitemaps/records-1.xmlx",
      "/sitemaps/records-9007199254740992.xml",
    ])
      assert.equal((await seoResponse(env, path))!.status, 404);
    assert.equal(await seoResponse(env, "/report/1"), null);
  } finally {
    db.close();
  }
});

test("pagination covers every URL without exceeding the per-file limit", async () => {
  const { db, env } = fixture();
  try {
    const insert = db.prepare("INSERT INTO reports VALUES(?,1,'public',NULL)");
    for (let id = 4; id <= 2004; id++) insert.run(id);
    const index = urls(await (await seoResponse(env, "/sitemap.xml"))!.text());
    assert.equal(index.length, 4);
    const all: string[] = [];
    for (const url of index.slice(1)) {
      const entries = urls(
        await (await seoResponse(env, new URL(url).pathname))!.text(),
      );
      assert.ok(entries.length <= 1000);
      all.push(...entries);
    }
    assert.equal(all.length, 2007);
    assert.equal(new Set(all).size, all.length);
  } finally {
    db.close();
  }
});

test("robots uses the configured origin and staging blocks crawling", async () => {
  const { db, env } = fixture();
  try {
    assert.match(
      await (await seoResponse(env, "/robots.txt"))!.text(),
      /Sitemap: https:\/\/proofs.rs\/sitemap.xml/,
    );
    const pages = urls(
      await (await seoResponse(env, "/sitemaps/pages.xml"))!.text(),
    );
    assert.ok(pages.includes("https://proofs.rs/book/"));
    assert.ok(
      !pages.some((url) => /\/(account|login|admin|settings|runs)\b/.test(url)),
    );
    const custom = await seoResponse(
      { ...env, APP_ORIGIN: "https://a&b.example" },
      "/sitemaps/pages.xml",
    );
    assert.match(await custom!.text(), /https:\/\/a&amp;b\.example/);
    const staging = { ...env, ENVIRONMENT: "staging" };
    assert.equal(
      await (await seoResponse(staging, "/robots.txt"))!.text(),
      "User-agent: *\nDisallow: /\n",
    );
    assert.equal((await seoResponse(staging, "/sitemap.xml"))!.status, 404);
  } finally {
    db.close();
  }
});

test("every Book chapter is discoverable without duplicate URLs", async () => {
  const { db, env } = fixture();
  try {
    const response = await seoResponse(env, "/sitemaps/pages.xml");
    const pages = urls(await response!.text());
    const summary = readFileSync(
      new URL("../book/src/SUMMARY.md", import.meta.url),
      "utf8",
    );
    for (const [, chapter] of summary.matchAll(/\]\(([^)]+)\.md\)/g)) {
      const path = chapter === "index" ? "/book/" : `/book/${chapter}.html`;
      assert.ok(pages.includes("https://proofs.rs" + path), path);
    }
    assert.equal(new Set(pages).size, pages.length);
  } finally {
    db.close();
  }
});

test("private-only crates and releases stay excluded and shared APIs appear once", async () => {
  const { db, env } = fixture();
  try {
    db.exec(`
      INSERT INTO crates VALUES(2,'private-only'),(3,'withdrawn-only');
      INSERT INTO releases VALUES(2,2,'2.0.0'),(3,3,'3.0.0'),(4,1,'4.0.0');
      UPDATE reports SET release_id=id WHERE id IN (2,3);
      INSERT INTO reports VALUES(4,4,'hidden',NULL),(5,1,'public',NULL);
      INSERT INTO report_revisions VALUES(5,1);
      INSERT INTO claims VALUES('shared',5,'api-current');
      INSERT INTO claim_revisions VALUES('shared',1);
    `);
    const entries = urls(
      await (await seoResponse(env, "/sitemaps/records-1.xml"))!.text(),
    );
    assert.equal(
      entries.filter((url) => url.endsWith("/api/api-current")).length,
      1,
    );
    assert.ok(entries.includes("https://proofs.rs/claim/shared"));
    assert.ok(entries.includes("https://proofs.rs/report/5"));
    assert.ok(
      !entries.some((url) => /private-only|withdrawn-only|4\.0\.0/.test(url)),
    );
    assert.equal(entries.length, 8);
  } finally {
    db.close();
  }
});

test("an empty registry still advertises documentation", async () => {
  const { db, env } = fixture();
  try {
    db.exec(
      "DELETE FROM claims; DELETE FROM claim_revisions; DELETE FROM reports; DELETE FROM tools;",
    );
    assert.deepEqual(
      urls(await (await seoResponse(env, "/sitemap.xml"))!.text()),
      ["https://proofs.rs/sitemaps/pages.xml"],
    );
    assert.equal(
      (await seoResponse(env, "/sitemaps/records-1.xml"))!.status,
      404,
    );
  } finally {
    db.close();
  }
});

test("worker serves dynamic XML and HEAD without cookies or asset access", async () => {
  const { db, env } = fixture();
  try {
    // Path identifiers and query values must survive XML parsing and URL decoding.
    db.prepare("INSERT INTO tools VALUES(?,1)").run(`a&<>"'/?#`);
    for (const path of ["/sitemap.xml", "/sitemaps/records-1.xml"]) {
      const response = await app.request("https://proofs.rs" + path, {}, env);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("set-cookie"), null);
      assert.equal(
        response.headers.get("cache-control"),
        "public, max-age=300",
      );
      const document = new JSDOM(await response.text(), {
        contentType: "application/xml",
      }).window.document;
      assert.equal(
        document.documentElement.namespaceURI,
        "http://www.sitemaps.org/schemas/sitemap/0.9",
      );
      if (path.includes("records")) {
        const entries = [...document.querySelectorAll("loc")].map(
          (loc) => new URL(loc.textContent!),
        );
        assert.ok(
          entries.some(
            (url) => decodeURIComponent(url.pathname) === `/tool/a&<>"'/?#`,
          ),
        );
      }
      const head = await app.request(
        "https://proofs.rs" + path,
        { method: "HEAD" },
        env,
      );
      assert.equal(head.status, 200);
      assert.equal(
        head.headers.get("content-type"),
        response.headers.get("content-type"),
      );
      assert.equal(await head.text(), "");
    }
    for (const path of [
      "/sitemap.xml",
      "/sitemaps/pages.xml",
      "/sitemaps/records-1.xml",
    ]) {
      const response = await app.request(
        "https://staging.example" + path,
        {},
        { ...env, ENVIRONMENT: "staging", DB: undefined },
      );
      assert.equal(response.status, 404);
      assert.equal(response.headers.get("X-Robots-Tag"), "noindex, nofollow");
      assert.equal(response.headers.get("cache-control"), "no-store");
    }
  } finally {
    db.close();
  }
});
