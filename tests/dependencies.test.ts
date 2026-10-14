import { test } from "node:test";
import assert from "node:assert/strict";
import { dependencyCatalog, matchesDependency } from "../src/dependencies";
import type { Env } from "../src/core";

function environment(cached: any = null, available: any[] = []) {
  const puts: string[] = [];
  const env = {
    ARCHIVE: {
      get: async () => (cached === null ? null : { json: async () => cached }),
      put: async (_key: string, body: string) => {
        puts.push(body);
      },
    },
    DB: {
      prepare: () => ({
        bind: () => ({ all: async () => ({ results: available }) }),
      }),
    },
  } as unknown as Env;
  return { env, puts };
}

test("dependency reports follow Cargo requirements, not npm bare-version ranges", () => {
  for (const [version, requirement, expected] of [
    ["1.9.0", "1.2", true],
    ["2.0.0", "1.2", false],
    ["0.2.9", "0.2.3", true],
    ["0.3.0", "0.2.3", false],
    ["0.0.4", "0.0.3", false],
    ["1.4.0", ">=1.2, <1.5", true],
    ["1.5.0", ">=1.2, <1.5", false],
    ["1.3.0", "~1.2", false],
    ["1.2.3", "=1.2.3", true],
    ["1.2.4", "=1.2.3", false],
    ["1.2.3", "1.*", true],
    ["1.3.0-beta.1", "^1.2", false],
  ] as const)
    assert.equal(
      matchesDependency(version, requirement),
      expected,
      `${version}: ${requirement}`,
    );
});

test("fetches every direct dependency kind and caches only release metadata", async (t) => {
  const { env, puts } = environment();
  t.mock.method(globalThis, "fetch", async (url: URL, options: any) => {
    assert.equal(
      String(url),
      "https://crates.io/api/v1/crates/sample/1.0.0/dependencies",
    );
    assert.equal(options.redirect, "manual");
    return Response.json({
      dependencies: [
        {
          crate_id: "a",
          req: "^1",
          kind: "normal",
          optional: false,
          target: null,
        },
        {
          crate_id: "b",
          req: "2",
          kind: "build",
          optional: true,
          target: "cfg(unix)",
        },
        { crate_id: "c", req: "3", kind: "dev", optional: false, target: null },
      ],
    });
  });
  const list = await dependencyCatalog(env, "sample", "1.0.0");
  assert.deepEqual(
    list?.map((d) => [d.crate, d.kind, d.optional, d.target]),
    [
      ["a", "normal", false, null],
      ["b", "build", true, "cfg(unix)"],
      ["c", "dev", false, null],
    ],
  );
  assert.equal(puts.length, 1);
  assert.ok(list?.every((d) => d.reports.length === 0));
});

test("cached metadata gets fresh available reports and preserves reviewed revisions", async (t) => {
  t.mock.method(globalThis, "fetch", () => {
    throw Error("Must use cache");
  });
  const metadata = [
    {
      crate: "a",
      requirement: "1.2",
      kind: "normal",
      optional: false,
      target: null,
      reports: [],
    },
  ];
  const { env, puts } = environment(metadata, [
    { crate: "a", version: "1.2.0", report: 1, revision: 9 },
    { crate: "a", version: "1.9.0", report: 2, revision: 3 },
    { crate: "a", version: "2.0.0", report: 3, revision: 1 },
    { crate: "a", version: "1.3.0-beta.1", report: 4, revision: 1 },
  ]);
  const list = await dependencyCatalog(env, "sample", "1.0.0", [
    { crate: "a", version: "1.2.0", report: 1, revision: 2, withdrawn: false },
    { crate: "a", version: "1.4.0", report: 5, revision: 1, withdrawn: true },
    {
      crate: "a",
      version: "1.3.0",
      report: null,
      revision: null,
      withdrawn: true,
    },
  ]);
  assert.deepEqual(
    list?.[0].reports.map((r) => [r.report, r.revision, !!r.reviewed]),
    [
      [1, 2, true],
      [5, 1, true],
      [2, 3, false],
    ],
  );
  assert.equal(puts.length, 0);
  assert.deepEqual(metadata[0].reports, []);
});

test("real zero dependencies is cached, upstream failures are retryable", async (t) => {
  const { env, puts } = environment();
  const mock = t.mock.method(
    globalThis,
    "fetch",
    async () => new Response("Unavailable", { status: 503 }),
  );
  assert.equal(await dependencyCatalog(env, "sample", "1.0.0"), null);
  assert.equal(puts.length, 0);
  mock.mock.mockImplementation(async () => Response.json({ dependencies: [] }));
  assert.deepEqual(await dependencyCatalog(env, "sample", "1.0.0"), []);
  assert.equal(puts.length, 1);
  mock.mock.mockImplementation(() => {
    throw Error("No fetch for cached empty list");
  });
  assert.deepEqual(
    await dependencyCatalog(environment([]).env, "sample", "1.0.0"),
    [],
  );
});

test("invalid responses and redirects cannot become an empty dependency list", async (t) => {
  const { env, puts } = environment();
  const mock = t.mock.method(globalThis, "fetch", async () =>
    Response.json({ error: "Missing dependencies" }),
  );
  assert.equal(await dependencyCatalog(env, "sample", "1.0.0"), null);
  mock.mock.mockImplementation(
    async () =>
      new Response(null, {
        status: 302,
        headers: { Location: "https://example.com/private" },
      }),
  );
  assert.equal(await dependencyCatalog(env, "sample", "1.0.0"), null);
  assert.equal(mock.mock.callCount(), 2);
  assert.equal(puts.length, 0);
});

test("cache write failures still display fetched metadata", async (t) => {
  const { env } = environment();
  t.mock.method(env.ARCHIVE, "put", async () => {
    throw Error("Cache unavailable");
  });
  t.mock.method(globalThis, "fetch", async () =>
    Response.json({ dependencies: [] }),
  );
  assert.deepEqual(await dependencyCatalog(env, "sample", "1.0.0"), []);
});
