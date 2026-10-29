import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setImmediate } from "node:timers/promises";
import { JSDOM } from "jsdom";
import type { Env } from "../src/core";
import {
  githubRepository,
  githubIssueDraft,
  githubIssueURL,
  upstreamRepository,
  githubIssueTemplates,
} from "../src/github-issue";
import { createViews } from "../src/site-views";

function archive() {
  const objects = new Map<string, any>();
  const env = {
    ARCHIVE: {
      get: async (key: string) =>
        objects.has(key) ? { json: async () => objects.get(key) } : null,
      put: async (key: string, value: string) =>
        objects.set(key, JSON.parse(value)),
    },
  } as unknown as Env;
  return { objects, env };
}
const cacheKey = "cache/crates.io/repositories/sample.json";
const finding = {
  id: "finding-id",
  report_id: 42,
  origin_revision_no: 2,
  title: '日本語 <script> & "quotes"',
  body: "## Reproduction\n\n```rust\npanic!();\n```\n\n日本語 & # ?",
  crate: "sample",
  version: "1.0.0",
  evidence_url: "https://example.test/evidence?a=1&b=2",
  apis: [{ display_path: "sample::safe" }],
  links: [],
  github_issue_available: true,
};

test("repository normalization accepts only plain HTTPS GitHub repositories", () => {
  assert.equal(
    githubRepository("https://github.com/upstream/repo.git/"),
    "https://github.com/upstream/repo",
  );
  assert.equal(
    githubRepository("https://GITHUB.COM/Upstream/repo/"),
    "https://github.com/Upstream/repo",
  );
  for (const url of [
    "http://github.com/a/b",
    "git@github.com:a/b.git",
    "https://gitlab.com/a/b",
    "https://github.com.evil.test/a/b",
    "https://user:pass@github.com/a/b",
    "https://github.com:443/a/b",
    "https://github.com/a/b/tree/main",
    "https://github.com/a/b?x=1",
    "https://github.com/a/b#readme",
    "https://github.com/a/..",
    "https://github.com/a/.git",
    "https://github.com/a/%2e%2e",
    "https://github.com/a/b\\c",
  ])
    assert.equal(githubRepository(url), null, url);
});

test("upstream lookup uses current crates.io metadata, cache expiry and no GitHub fetch", async (t) => {
  const { env, objects } = archive();
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (url: URL, init: RequestInit) => {
    assert.equal(String(url), "https://crates.io/api/v1/crates/sample");
    assert.equal(init.redirect, "manual");
    assert.ok(init.signal instanceof AbortSignal);
    calls++;
    return Response.json({
      crate: {
        name: "sample",
        repository: `https://github.com/upstream/repo${calls}.git`,
      },
    });
  });
  assert.deepEqual(await upstreamRepository(env, "sample"), {
    repository: "https://github.com/upstream/repo1",
  });
  assert.deepEqual(await upstreamRepository(env, "sample"), {
    repository: "https://github.com/upstream/repo1",
  });
  assert.equal(calls, 1);
  objects.get(cacheKey).fetchedAt = Date.now() - 5 * 60 * 1000;
  assert.deepEqual(await upstreamRepository(env, "sample"), {
    repository: "https://github.com/upstream/repo2",
  });
  assert.equal(calls, 2);
  objects.get(cacheKey).fetchedAt = Date.now() + 60000;
  await upstreamRepository(env, "sample");
  assert.equal(calls, 3);
});

test("missing and unsupported repositories remain distinct from failed lookups", async (t) => {
  const { env, objects } = archive();
  let response: unknown = { crate: { name: "sample", repository: null } };
  t.mock.method(globalThis, "fetch", async () => Response.json(response));
  assert.deepEqual(await upstreamRepository(env, "sample"), {
    repository: null,
    reason: "missing",
  });
  objects.clear();
  response = {
    crate: { name: "sample", repository: "https://gitlab.com/upstream/repo" },
  };
  assert.deepEqual(await upstreamRepository(env, "sample"), {
    repository: null,
    reason: "unsupported",
  });
  objects.clear();
  response = {
    crate: {
      name: "another-crate",
      repository: "https://github.com/wrong/repo",
    },
  };
  assert.deepEqual(await upstreamRepository(env, "sample"), {
    repository: null,
    reason: "unavailable",
  });
  assert.equal(objects.size, 0);
});

test("failures, foreign redirects and oversized metadata are not cached or replaced by stale metadata", async (t) => {
  const { env, objects } = archive();
  objects.set(cacheKey, {
    name: "sample",
    repository: "https://github.com/old/repo",
    fetchedAt: 0,
  });
  let response = new Response(null, { status: 503 });
  t.mock.method(globalThis, "fetch", async (url: URL) => {
    assert.equal(url.hostname, "crates.io");
    return response;
  });
  assert.deepEqual(await upstreamRepository(env, "sample"), {
    repository: null,
    reason: "unavailable",
  });
  assert.equal(objects.get(cacheKey).fetchedAt, 0);
  response = new Response(null, {
    status: 302,
    headers: { Location: "https://evil.test/metadata" },
  });
  assert.deepEqual(await upstreamRepository(env, "sample"), {
    repository: null,
    reason: "unavailable",
  });
  response = new Response("x".repeat(1024 * 1024 + 1));
  assert.deepEqual(await upstreamRepository(env, "sample"), {
    repository: null,
    reason: "unavailable",
  });
});

test("offline demo lookup uses fixtures without a network fallback or cache expiry", async (t) => {
  const { env, objects } = archive();
  env.EXTERNAL_FETCH_DISABLED = "true";
  t.mock.method(globalThis, "fetch", async () => {
    throw Error("Must not fetch");
  });
  objects.set(cacheKey, {
    name: "sample",
    repository: "https://github.com/cached/repo",
    fetchedAt: Date.now(),
  });
  assert.deepEqual(await upstreamRepository(env, "sample"), {
    repository: null,
    reason: "unavailable",
  });
  objects.set("local-demo/crates.io/repositories/sample.json", {
    name: "sample",
    repository: "https://github.com/example/sample",
  });
  assert.deepEqual(await upstreamRepository(env, "sample"), {
    repository: "https://github.com/example/sample",
  });
});

test("cache failures do not hide fresh upstream metadata", async (t) => {
  const { env } = archive();
  Object.assign(env.ARCHIVE, {
    get: async () => {
      throw Error("Cache read failed");
    },
    put: async () => {
      throw Error("Cache write failed");
    },
  });
  t.mock.method(globalThis, "fetch", async () =>
    Response.json({
      crate: { name: "sample", repository: "https://github.com/upstream/repo" },
    }),
  );
  assert.deepEqual(await upstreamRepository(env, "sample"), {
    repository: "https://github.com/upstream/repo",
  });
});

test("upstream requests time out after five seconds", async (t) => {
  const { env } = archive();
  t.mock.method(
    globalThis,
    "fetch",
    async (_url: URL, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal!.addEventListener(
          "abort",
          () => reject(init.signal!.reason),
          { once: true },
        );
      }),
  );
  // AbortSignal.timeout is unref'ed; retain a timer while waiting for its abort.
  const keepAlive = globalThis.setTimeout(() => {}, 10000);
  try {
    assert.deepEqual(await upstreamRepository(env, "sample"), {
      repository: null,
      reason: "unavailable",
    });
  } finally {
    clearTimeout(keepAlive);
  }
});

test("issue draft preserves Markdown and provenance; URLs fall back without truncation", () => {
  const draft = githubIssueDraft(finding, "https://proofs.example");
  assert.ok(draft.body.startsWith(finding.body));
  assert.equal(
    draft.body,
    finding.body +
      "\n\n---\nThis issue was discovered as part of formal verification work on proofs.rs; see https://proofs.example/report/42?v=2 for details.",
  );
  const full = githubIssueURL("https://github.com/upstream/repo", draft);
  assert.equal(full.prefill, "all");
  assert.equal(new URL(full.url).searchParams.get("title"), finding.title);
  assert.equal(new URL(full.url).searchParams.get("body"), draft.body);
  const long = { ...draft, body: "日本語".repeat(3000) };
  const fallback = githubIssueURL("https://github.com/upstream/repo", long);
  assert.equal(fallback.prefill, "title");
  assert.equal(new URL(fallback.url).searchParams.has("body"), false);
  assert.equal(long.body, "日本語".repeat(3000));
  const hugeTitle = githubIssueURL("https://github.com/upstream/repo", {
    ...long,
    title: "日".repeat(1000),
  });
  assert.equal(hugeTitle.prefill, "none");
  assert.ok(hugeTitle.url.length <= 8192);
});

test("saved authors get the issue action; local drafts and CLI previews do not", () => {
  const views = createViews({}, {}, () => "");
  assert.match(views.findingItem(finding, true), /Create GitHub issue/);
  assert.match(views.findingItem(finding, true), /Add issue URL/);
  assert.doesNotMatch(
    views.findingItem({ ...finding, links: [{ kind: "issue" }] }, true),
    /finding-issue-actions/,
  );
  for (const links of [
    [{ kind: "pr" }],
    [{ kind: "issue", deleted_at: "2026-10-26" }],
  ]) {
    assert.match(
      views.findingItem({ ...finding, links }, true),
      /finding-issue-actions/,
    );
  }
  assert.doesNotMatch(
    views.findingItem({ ...finding, github_issue_available: false }, true),
    /Create GitHub issue/,
  );
  assert.doesNotMatch(views.findingItem(finding), /Create GitHub issue/);
  assert.doesNotMatch(
    views.findingItem({ ...finding, draft: true }, true),
    /Create GitHub issue/,
  );
  assert.doesNotMatch(
    views.findingItem({ ...finding, withdrawn_at: "withdrawn" }, true),
    /Create GitHub issue/,
  );
  assert.doesNotMatch(
    createViews({}, {}, () => "", { preview: true }).findingItem(finding, true),
    /Create GitHub issue/,
  );
});

test("copy buttons preserve the entire body and select it when clipboard access fails", async () => {
  const dom = new JSDOM(
    '<section data-issue-draft><input id="issue-title"><textarea id="issue-body"></textarea><button data-copy-issue="issue-title">Copy title</button><button data-copy-issue="issue-body">Copy body</button><p data-copy-status role="status"></p></section>',
    {
      url: "https://example.test/finding/id/github-issue",
      runScripts: "outside-only",
    },
  );
  const document = dom.window.document;
  const body = document.querySelector<HTMLTextAreaElement>("#issue-body")!;
  body.value = "日本語\n".repeat(3000);
  document.querySelector<HTMLInputElement>("#issue-title")!.value =
    finding.title;
  let copied = "";
  Object.defineProperty(dom.window.navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: async (value: string) => {
        copied = value;
      },
    },
  });
  dom.window.eval(
    readFileSync(new URL("../public/site.js", import.meta.url), "utf8"),
  );
  document
    .querySelector<HTMLButtonElement>('[data-copy-issue="issue-body"]')!
    .click();
  await setImmediate();
  assert.equal(copied, body.value);
  assert.equal(
    document.querySelector("[data-copy-status]")!.textContent,
    "Copied",
  );
  document
    .querySelector<HTMLButtonElement>('[data-copy-issue="issue-title"]')!
    .click();
  await setImmediate();
  assert.equal(copied, finding.title);
  Object.defineProperty(dom.window.navigator, "clipboard", {
    value: undefined,
  });
  document
    .querySelector<HTMLButtonElement>('[data-copy-issue="issue-body"]')!
    .click();
  await setImmediate();
  assert.equal(document.activeElement, body);
  assert.equal(body.selectionStart, 0);
  assert.equal(body.selectionEnd, body.value.length);
  assert.match(
    document.querySelector("[data-copy-status]")!.textContent!,
    /Selected/,
  );
  dom.window.close();
});

test("templates include Markdown, forms/configuration directories and inherited defaults", async (t) => {
  const { env, objects } = archive();
  let templatePath = "project/contents/.github";
  let entries = [{ name: "ISSUE_TEMPLATE", type: "dir" }];
  const calls: string[] = [];
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    assert.equal(init.redirect, "manual");
    assert.ok(init.signal instanceof AbortSignal);
    calls.push(url);
    return Response.json(url.endsWith(templatePath) ? entries : []);
  });
  for (const [path, files] of [
    ["project/contents/.github", [{ name: "ISSUE_TEMPLATE", type: "dir" }]],
    ["project/contents/", [{ name: "ISSUE_TEMPLATE.md", type: "file" }]],
    [
      "project/contents/docs",
      [{ name: "issue_template.markdown", type: "file" }],
    ],
    [".github/contents/.github", [{ name: "ISSUE_TEMPLATE", type: "dir" }]],
  ] as const) {
    objects.clear();
    templatePath = path;
    entries = files.map((entry) => ({ ...entry }));
    assert.equal(
      await githubIssueTemplates(env, "https://github.com/upstream/project"),
      true,
      path,
    );
  }
  const previousCalls = calls.length;
  assert.equal(
    await githubIssueTemplates(env, "https://github.com/upstream/project"),
    true,
  );
  assert.equal(calls.length, previousCalls);
  objects.clear();
  templatePath = "missing";
  assert.equal(
    await githubIssueTemplates(env, "https://github.com/upstream/project"),
    false,
  );
  assert.equal(calls.length, previousCalls + 6);
  const chooser = new URL(
    githubIssueURL(
      "https://github.com/upstream/project",
      { title: "Bug", body: "Do not replace template" },
      true,
    ).url,
  );
  assert.equal(chooser.pathname, "/upstream/project/issues/new/choose");
  assert.equal(chooser.searchParams.get("title"), "Bug");
  assert.equal(chooser.searchParams.has("body"), false);
});

test("failed or incomplete template lookups use the chooser and do not cache absence", async (t) => {
  const { env, objects } = archive();
  let response = () => new Response(null, { status: 403 });
  t.mock.method(globalThis, "fetch", async () => response());
  for (const makeResponse of [
    () => new Response(null, { status: 403 }),
    () =>
      new Response(null, {
        status: 302,
        headers: { Location: "https://evil.test" },
      }),
    () => Response.json({ message: "invalid" }),
    () =>
      Response.json(
        Array.from({ length: 1000 }, () => ({ name: "file", type: "file" })),
      ),
    () => new Response("x".repeat(1024 * 1024 + 1)),
  ]) {
    response = makeResponse;
    assert.equal(
      await githubIssueTemplates(env, "https://github.com/upstream/project"),
      null,
    );
    assert.equal(objects.size, 0);
  }
  response = () => new Response(null, { status: 404 });
  assert.equal(
    await githubIssueTemplates(env, "https://github.com/upstream/project"),
    false,
  );
  const key = "cache/github/issue-templates/upstream/project.json";
  objects.get(key).fetchedAt = 0;
  response = () => new Response(null, { status: 503 });
  assert.equal(
    await githubIssueTemplates(env, "https://github.com/upstream/project"),
    null,
  );
  assert.equal(objects.get(key).fetchedAt, 0);
  const url = new URL(
    githubIssueURL(
      "https://github.com/upstream/project",
      { title: "Bug", body: "Body" },
      null,
    ).url,
  );
  assert.equal(url.pathname, "/upstream/project/issues/new/choose");
  assert.equal(url.searchParams.has("body"), false);
});

test("offline template fixtures never access GitHub or use the production cache", async (t) => {
  const { env, objects } = archive();
  env.EXTERNAL_FETCH_DISABLED = "true";
  t.mock.method(globalThis, "fetch", async () => {
    throw Error("Must not fetch");
  });
  objects.set("cache/github/issue-templates/upstream/project.json", {
    hasTemplates: false,
    fetchedAt: Date.now(),
  });
  assert.equal(
    await githubIssueTemplates(env, "https://github.com/upstream/project"),
    null,
  );
  objects.set("local-demo/github/issue-templates/upstream/project.json", {
    hasTemplates: true,
  });
  assert.equal(
    await githubIssueTemplates(env, "https://github.com/upstream/project"),
    true,
  );
  assert.equal(
    await githubIssueTemplates(env, "https://gitlab.com/upstream/project"),
    null,
  );
});
