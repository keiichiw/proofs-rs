import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(
  new URL("../.github/workflows/notify-deploy.yml", import.meta.url),
  "utf8",
);
const script = workflow
  .split("          script: |\n")[1]
  .replace(/^            /gm, "");
const execute = new (Object.getPrototypeOf(async function () {}).constructor)(
  "process",
  "context",
  "core",
  "fetch",
  "github",
  script,
);

async function notify(
  result: string,
  options: {
    webhook?: string;
    pr?: boolean;
    status?: number;
    fail?: boolean;
    message?: string;
    push?: boolean;
    lookupFail?: boolean;
    pushSha?: string;
  } = {},
) {
  const warnings: string[] = [];
  const lookups: { owner: string; repo: string; ref: string }[] = [];
  const requests: {
    url: URL;
    body: {
      embeds: {
        title: string;
        description: string;
        color: number;
        url: string;
        fields: { name: string; value: string }[];
      }[];
      allowed_mentions: { parse: string[] };
    };
  }[] = [];
  await execute(
    {
      env: {
        DISCORD_WEBHOOK_URL:
          options.webhook ??
          "https://discord.com/api/webhooks/test/secret?thread_id=123",
        DEPLOY_ENVIRONMENT: "staging",
        DEPLOY_RESULT: result,
        GITHUB_SERVER_URL: "https://github.com",
        GITHUB_RUN_ATTEMPT: "2",
      },
    },
    {
      repo: { owner: "proofs-rs", repo: "proofs-rs" },
      workflow: "Staging",
      runId: 42,
      sha: "merge-sha",
      ref: "refs/heads/main",
      payload: options.pr
        ? {
            pull_request: {
              number: 88,
              title: "Fix report tool links",
              head: { sha: "head-sha", ref: "staging/test" },
            },
          }
        : options.push
          ? {
              head_commit: {
                id: options.pushSha ?? "merge-sha",
                message: options.message ?? "Fix report tool links",
              },
            }
          : {},
    },
    { warning: (message: string) => warnings.push(message) },
    async (url: URL, request: { body: string }) => {
      requests.push({ url, body: JSON.parse(request.body) });
      if (options.fail) throw new Error(`request failed at ${url}`);
      return {
        ok: (options.status ?? 200) === 200,
        status: options.status ?? 200,
      };
    },
    {
      rest: {
        repos: {
          getCommit: async (args: {
            owner: string;
            repo: string;
            ref: string;
          }) => {
            lookups.push(args);
            if (options.lookupFail) throw new Error("lookup failed");
            return {
              data: {
                commit: { message: options.message ?? "Fix report tool links" },
              },
            };
          },
        },
      },
    },
  );
  return { warnings, requests, lookups };
}

test("Discord deployment notification sends success/failure and the PR head with a run-attempt link", async () => {
  for (const result of ["success", "failure"]) {
    const { warnings, requests } = await notify(result, { pr: true });
    assert.deepEqual(warnings, []);
    assert.equal(requests.length, 1);
    const { url, body } = requests[0];
    assert.equal(url.searchParams.get("wait"), "true");
    assert.equal(url.searchParams.get("thread_id"), "123");
    assert.deepEqual(body.allowed_mentions, { parse: [] });
    const embed = body.embeds[0];
    assert.equal(
      embed.title,
      `staging: deploy ${result === "success" ? "succeeded" : "failed"} — Fix report tool links`,
    );
    assert.equal(embed.color, result === "success" ? 0x2ecc71 : 0xe74c3c);
    assert.equal(
      embed.url,
      "https://github.com/proofs-rs/proofs-rs/actions/runs/42/attempts/2",
    );
    assert.equal(
      embed.fields.find((field) => field.name === "Commit")?.value,
      "[head-sh](https://github.com/proofs-rs/proofs-rs/commit/head-sha)",
    );
    assert.equal(
      embed.fields.find((field) => field.name === "Ref")?.value,
      "staging/test",
    );
  }
});

test("production merge notifications show the PR title, full message and PR link", async () => {
  const message =
    "Merge pull request #88 from keiichiw/codex/reports-tool-filter\n\nFix report tool links and automatically apply tool filters";
  const { warnings, requests, lookups } = await notify("success", {
    push: true,
    message,
  });
  const embed = requests[0].body.embeds[0];
  assert.deepEqual(warnings, []);
  assert.deepEqual(lookups, []);
  assert.equal(
    embed.title,
    "staging: deploy succeeded — Fix report tool links and automatically apply tool filters",
  );
  assert.match(
    embed.description,
    /Fix report tool links and automatically apply tool filters/,
  );
  assert.equal(
    embed.fields.find((field) => field.name === "Pull request")?.value,
    "[#88](https://github.com/proofs-rs/proofs-rs/pull/88)",
  );
});

test("manual runs fetch the exact target commit and lookup errors still send a notification", async () => {
  for (const options of [{}, { push: true, pushSha: "different-sha" }]) {
    const { requests, lookups } = await notify("success", options);
    assert.deepEqual(lookups, [
      { owner: "proofs-rs", repo: "proofs-rs", ref: "merge-sha" },
    ]);
    assert.match(requests[0].body.embeds[0].title, /Fix report tool links$/);
  }
  const failed = await notify("failure", { lookupFail: true });
  assert.equal(failed.warnings.length, 1);
  assert.equal(failed.requests.length, 1);
  assert.equal(
    failed.requests[0].body.embeds[0].description,
    "Commit message unavailable.",
  );
});

test("long commit messages fit Discord embed limits and escape Markdown", async () => {
  const { requests } = await notify("success", {
    push: true,
    message: "*[change](https://example.com)* ".repeat(400),
  });
  const embed = requests[0].body.embeds[0];
  assert.equal(embed.title.length, 256);
  assert.equal(embed.description.length, 3500);
  assert.ok(
    embed.description.startsWith("\\*\\[change\\]\\(https://example.com\\)\\*"),
  );
  assert.ok(embed.description.endsWith("…"));
});

test("missing webhook skips sending; failed deliveries warn without exposing the webhook", async () => {
  const missing = await notify("success", { webhook: "" });
  assert.equal(missing.requests.length, 0);
  assert.equal(missing.warnings.length, 1);
  for (const options of [
    { status: 429 },
    { fail: true },
    { webhook: "invalid secret" },
  ]) {
    const { warnings } = await notify("failure", options);
    assert.equal(warnings.length, 1);
    assert.doesNotMatch(warnings[0], /webhooks\/test|invalid secret/);
  }
});
