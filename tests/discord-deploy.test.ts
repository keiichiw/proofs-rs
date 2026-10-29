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
  script,
);

async function notify(
  result: string,
  options: {
    webhook?: string;
    pr?: boolean;
    status?: number;
    fail?: boolean;
  } = {},
) {
  const warnings: string[] = [];
  const requests: {
    url: URL;
    body: {
      embeds: {
        title: string;
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
        ? { pull_request: { head: { sha: "head-sha", ref: "staging/test" } } }
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
  );
  return { warnings, requests };
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
      `staging: deploy ${result === "success" ? "succeeded" : "failed"}`,
    );
    assert.equal(embed.color, result === "success" ? 0x2ecc71 : 0xe74c3c);
    assert.equal(
      embed.url,
      "https://github.com/proofs-rs/proofs-rs/actions/runs/42/attempts/2",
    );
    assert.equal(
      embed.fields.find((field) => field.name === "Commit")?.value,
      "head-sha",
    );
    assert.equal(
      embed.fields.find((field) => field.name === "Ref")?.value,
      "staging/test",
    );
  }
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
