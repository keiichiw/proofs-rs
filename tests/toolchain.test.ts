import test from "node:test";
import assert from "node:assert/strict";
import { toolchain as schema } from "../src/schemas";
import { readRecord, validateReportRuns } from "../src/runs";
import {
  compareToolchains,
  sourceIdentity,
  toolchainLabel,
  toolchainSourceIdentity,
  validateAeneasToolchain,
  type Toolchain,
} from "../web/toolchain";

const base = "a".repeat(40);
function fixture(): Toolchain {
  return {
    schema_version: 1,
    components: {
      aeneas: {
        tool: "aeneas",
        source: {
          kind: "git_patch",
          repository: "https://github.com/AeneasVerif/aeneas",
          base_commit: base,
          patch: {
            path: "proofs/toolchain/aeneas.patch",
            sha256: "b".repeat(64),
          },
        },
        materialized: { git_tree: "c".repeat(40) },
      },
      charon: {
        tool: "charon",
        source: {
          kind: "git",
          repository: "https://github.com/AeneasVerif/charon",
          commit: "d".repeat(40),
        },
      },
      lean: {
        tool: "lean",
        source: { kind: "release", release_id: "leanprover/lean4:v4.22.0" },
      },
    },
    uses: [
      {
        component: "aeneas",
        role: "lean_library",
        observation: {
          kind: "dependency_resolved",
          dependency_name: "aeneas",
          subdirectory: "backends/lean",
        },
      },
      {
        component: "aeneas",
        role: "translator",
        observation: { kind: "not_run" },
      },
      {
        component: "charon",
        role: "rust_frontend",
        observation: { kind: "not_run" },
      },
      {
        component: "lean",
        role: "proof_checker",
        observation: {
          kind: "process_executed",
          reported_version:
            "Lean (version 4.22.0, x86_64-unknown-linux-gnu, Release)",
        },
      },
    ],
  };
}
function sarif(descriptor: Toolchain | undefined = fixture()): any {
  const source = { file: "Proofs.lean", first_line: 1, last_line: 2 };
  return {
    version: "2.1.0",
    runs: [
      {
        automationDetails: { guid: "33333333-3333-4333-8333-333333333333" },
        tool: {
          driver: {
            name: "aeneas",
            version: base,
            ...(descriptor ? { fullName: toolchainLabel(descriptor) } : {}),
          },
        },
        versionControlProvenance: [
          {
            repositoryUri: "https://github.com/example/proof",
            revisionId: "e".repeat(40),
          },
        ],
        invocations: [
          {
            executableLocation: { uri: "lake" },
            arguments: ["build"],
            workingDirectory: { uri: "proofs/" },
            startTimeUtc: "2026-01-01T00:00:00Z",
            endTimeUtc: "2026-01-01T00:00:01Z",
            executionSuccessful: true,
            exitCode: 0,
            stdout: { index: 0 },
          },
        ],
        artifacts: [{ contents: { text: "checked" } }],
        results: [
          {
            ruleId: "aeneas.lean.theorem",
            kind: "pass",
            message: { text: "checked" },
            properties: { harness: "Proofs.safe" },
          },
        ],
        properties: {
          proofs: {
            schemaVersion: 2,
            crate: "sample",
            version: "1.0.0",
            dependencies: [],
            ...(descriptor
              ? {
                  toolchain: descriptor,
                  toolchain_input: { manifest_path: "Cargo.toml" },
                }
              : {}),
            contracts: [
              {
                ...source,
                harness: "Proofs.safe",
                api_paths: ["sample::safe"],
                precondition: "",
                formal: {
                  version: 1,
                  theorem: "Proofs.safe",
                  module: "Proofs",
                  statement: "True",
                  binders: [],
                  conclusion: "True",
                  program: null,
                  program_head: null,
                  axioms: [],
                  mapping: "manual",
                  manifest: null,
                  source,
                  definitions: [],
                  definitions_truncated: false,
                  translation_rerun: false,
                },
              },
            ],
          },
        },
      },
    ],
  };
}

test("strict toolchain unions reject malformed and ambiguous submitted metadata", () => {
  assert.equal(schema.safeParse(fixture()).success, true);
  const invalid: ((t: any) => void)[] = [
    (t) => (t.schema_version = 2),
    (t) => (t.components.aeneas.source.commit = base),
    (t) => (t.components.aeneas.source.patch.sha256 = "b".repeat(63)),
    (t) => (t.components.aeneas.materialized.git_tree = "c".repeat(39)),
    (t) => (t.components.lean.materialized = { git_tree: base }),
    (t) => (t.uses[0].component = "missing"),
    (t) => t.uses.push(structuredClone(t.uses[0])),
    (t) => (t.uses[1].observation.reported_version = "invented"),
    (t) => (t.uses[0].observation.kind = "process_executed"),
    (t) => (t.uses[3].observation.reported_version = " "),
  ];
  for (const path of [
    "/absolute.patch",
    "../escape.patch",
    "a/../b.patch",
    "a//b.patch",
    "./a.patch",
    "a/",
    "a\\b.patch",
    "C:a.patch",
    "a\u0000.patch",
  ])
    invalid.push((t) => (t.components.aeneas.source.patch.path = path));
  for (const mutate of invalid) {
    const t = fixture();
    mutate(t);
    assert.equal(schema.safeParse(t).success, false);
    const s = sarif();
    s.runs[0].properties.proofs.toolchain = t;
    assert.throws(() => readRecord(s));
  }
  for (const descriptor of [null, {}, { schema_version: 1 }]) {
    const s = sarif();
    s.runs[0].properties.proofs.toolchain = descriptor;
    assert.throws(
      () => readRecord(s),
      "A malformed descriptor cannot become legacy",
    );
  }
});

test("Aeneas adapter accepts only the supported three sources and four observations", () => {
  assert.deepEqual(readRecord(sarif()).toolchain, fixture());
  const legacy = sarif();
  delete legacy.runs[0].properties.proofs.toolchain;
  assert.equal(readRecord(legacy).toolchain, undefined);
  const invalid: ((s: any, t: any) => void)[] = [
    (_, t) => delete t.components.aeneas.materialized,
    (_, t) => (t.components.aeneas.tool = "lean"),
    (_, t) =>
      (t.components.aeneas.source.repository =
        "https://github.com/elsewhere/aeneas"),
    (_, t) =>
      (t.components.charon.source.repository =
        "https://github.com/elsewhere/charon"),
    (_, t) => (t.components.aeneas.source.base_commit = "f".repeat(40)),
    (_, t) => (t.components.extra = structuredClone(t.components.charon)),
    (_, t) => (t.components.lean.source.release_id = "elsewhere/lean:v4.22.0"),
    (_, t) =>
      (t.uses[3].observation.reported_version =
        "Lean (version 4.23.0, Release)"),
    (_, t) =>
      (t.uses[3].observation.reported_version = "Unrelated 4.22.0 output"),
    (_, t) =>
      (t.components.charon.source = structuredClone(
        t.components.aeneas.source,
      )),
    (_, t) =>
      (t.components.lean.source = structuredClone(t.components.aeneas.source)),
    (_, t) => (t.components.charon.materialized = { git_tree: base }),
    (_, t) => t.uses.pop(),
    (_, t) =>
      (t.uses[1].observation = {
        kind: "process_executed",
        reported_version: "Aeneas",
      }),
    (_, t) =>
      (t.uses[2].observation = {
        kind: "process_executed",
        reported_version: "Charon",
      }),
    (_, t) => (t.uses[0].observation.subdirectory = "other/lean"),
    (_, t) => (t.uses[0].component = "charon"),
    (s) => delete s.runs[0].tool.driver.fullName,
    (s) => (s.runs[0].properties.proofs.aeneas = { source: {} }),
    (s) => (s.runs[0].tool.driver.name = "kani"),
    (s) =>
      (s.runs[0].properties.proofs.contracts[0].formal.translation_rerun = true),
    (s) =>
      (s.runs[0].properties.proofs.contracts[0].formal.axioms = ["sorryAx"]),
  ];
  for (const mutate of invalid) {
    const s = sarif();
    mutate(s, s.runs[0].properties.proofs.toolchain);
    assert.throws(() => readRecord(s));
  }
});

test("patched Runs require a safe recorded package manifest for reproduction", () => {
  for (const input of [
    undefined,
    null,
    {},
    { manifest_path: "" },
    ...[
      "/Cargo.toml",
      "../Cargo.toml",
      "a/../Cargo.toml",
      "a//Cargo.toml",
      "a/./Cargo.toml",
      "a\\Cargo.toml",
      "a/Cargo.toml/",
      "NotCargo.toml",
    ].map((manifest_path) => ({ manifest_path })),
  ]) {
    const s = sarif();
    s.runs[0].properties.proofs.toolchain_input = input;
    assert.throws(() => readRecord(s));
  }
  for (const manifest_path of ["Cargo.toml", "workspace/package/Cargo.toml"]) {
    const s = sarif();
    s.runs[0].properties.proofs.toolchain_input = {
      manifest_path,
      future_fingerprint_field: {},
    };
    assert.doesNotThrow(() => readRecord(s));
  }
});

test("source identity resolves IDs and excludes path, ordering and observations", () => {
  const first = fixture(),
    second = fixture();
  const aeneas = second.components.aeneas;
  assert.equal(aeneas.source.kind, "git_patch");
  if (aeneas.source.kind !== "git_patch") throw new Error("fixture");
  aeneas.source.repository = "https://GITHUB.com/AeneasVerif/AENEAS.git/";
  aeneas.source.base_commit = base.toUpperCase();
  aeneas.source.patch.sha256 = aeneas.source.patch.sha256.toUpperCase();
  aeneas.source.patch.path = "different/location.patch";
  second.components = {
    l: second.components.lean,
    a: aeneas,
    c: second.components.charon,
  };
  second.uses.reverse();
  for (const use of second.uses) {
    use.component = (
      { aeneas: "a", lean: "l", charon: "c" } as Record<string, string>
    )[use.component];
    if (use.observation.kind === "process_executed")
      use.observation.reported_version = "another platform";
  }
  assert.equal(sourceIdentity(first.components.aeneas), sourceIdentity(aeneas));
  assert.equal(toolchainSourceIdentity(first), toolchainSourceIdentity(second));
  assert.doesNotThrow(() => compareToolchains([first, second]));
  assert.equal(toolchainLabel(first), toolchainLabel(second));
  // The generic comparison supports IDs; the initial adapter deliberately does not.
  assert.throws(() =>
    validateAeneasToolchain(
      second,
      { name: "aeneas", version: base, fullName: toolchainLabel(second) },
      [{ formal: { translation_rerun: false } }],
    ),
  );
});

test("multiple Runs reject different source identities, legacy mixing and tree inconsistencies", () => {
  assert.doesNotThrow(() => compareToolchains([undefined, undefined]));
  assert.throws(
    () => compareToolchains([undefined, fixture()]),
    /mixed_patched_and_legacy/,
  );
  const changes: ((t: any) => void)[] = [
    (t) => (t.components.aeneas.source.patch.sha256 = "f".repeat(64)),
    (t) => (t.components.charon.source.commit = "f".repeat(40)),
    (t) => (t.components.lean.source.release_id = "leanprover/lean4:v4.23.0"),
    (t) => (t.uses[0].component = "charon"),
  ];
  for (const change of changes) {
    const second = fixture();
    change(second);
    assert.throws(
      () => compareToolchains([fixture(), second]),
      /inconsistent_run_toolchain_sources/,
    );
  }
  const second = fixture();
  second.components.aeneas.materialized!.git_tree = "f".repeat(40);
  assert.equal(
    toolchainSourceIdentity(second),
    toolchainSourceIdentity(fixture()),
  );
  assert.throws(
    () => compareToolchains([fixture(), second]),
    /inconsistent_materialized_tree/,
  );
});

test("report validation checks every recorded Run before accepting Claim references", async () => {
  const firstId = "33333333-3333-4333-8333-333333333333";
  const secondId = "44444444-4444-4444-8444-444444444444";
  const first = sarif(),
    second = sarif();
  second.runs[0].automationDetails.guid = secondId;
  const records = new Map([
    [firstId, first],
    [secondId, second],
  ]);
  const context: any = {
    get: () => ({ id: "author", status: "active" }),
    env: {
      DB: {
        prepare: () => ({
          bind: (id: string) => ({
            first: async () =>
              records.has(id)
                ? {
                    id,
                    author_id: "author",
                    crate: "sample",
                    version: "1.0.0",
                    tool_version_id: "registered-base",
                    r2_key: id,
                  }
                : null,
          }),
        }),
      },
      ARCHIVE: {
        get: async (id: string) => ({ json: async () => records.get(id) }),
      },
    },
  };
  const input = { run_ids: [firstId, secondId] };
  const report = () => ({
    crate: "sample",
    version: "1.0.0",
    tool_version_id: "registered-base",
    claims: [
      {
        evidence_ref: { run_id: secondId, harness: "Proofs.safe" },
        display_path: "sample::safe",
        precondition: "",
      },
    ],
  });
  await assert.doesNotReject(validateReportRuns(context, input, report()));
  second.runs[0].properties.proofs.toolchain.components.aeneas.materialized.git_tree =
    "f".repeat(40);
  await assert.rejects(
    validateReportRuns(context, input, report()),
    /inconsistent_materialized_tree/,
  );
  records.set(secondId, sarif());
  delete records.get(secondId)!.runs[0].properties.proofs.toolchain;
  await assert.rejects(
    validateReportRuns(context, input, report()),
    /mixed_patched_and_legacy_runs/,
  );
  const patched = sarif();
  patched.runs[0].properties.proofs.toolchain.components.aeneas.source.patch.sha256 =
    "f".repeat(64);
  patched.runs[0].tool.driver.fullName = toolchainLabel(
    patched.runs[0].properties.proofs.toolchain,
  );
  records.set(secondId, patched);
  await assert.rejects(
    validateReportRuns(context, input, report()),
    /inconsistent_run_toolchain_sources/,
  );
});

test("saved revision and Claim labels use their own immutable Run projections", async () => {
  const { savedToolchainLabel, renderToolchain } =
    await import("../web/toolchain-view");
  const first = fixture(),
    second = fixture();
  if (second.components.aeneas.source.kind !== "git_patch")
    throw Error("fixture");
  second.components.aeneas.source.patch.sha256 = "f".repeat(64);
  const old = { toolchains_json: JSON.stringify([first, first]) };
  const current = { toolchains_json: JSON.stringify([second]) };
  assert.equal(savedToolchainLabel(old), toolchainLabel(first));
  assert.equal(savedToolchainLabel(current), toolchainLabel(second));
  assert.equal(
    savedToolchainLabel({ ...current, toolchain_json: JSON.stringify(first) }),
    toolchainLabel(first),
  );
  assert.throws(
    () =>
      savedToolchainLabel({ toolchains_json: JSON.stringify([first, null]) }),
    /mixed/,
  );
  assert.equal(savedToolchainLabel({ toolchains_json: "[null]" }), undefined);
  const html = renderToolchain(
    first,
    "https://github.com/test/proof",
    "e".repeat(40),
  );
  assert.ok(
    html.includes(`/blob/${"e".repeat(40)}/proofs/toolchain/aeneas.patch`),
  );
  assert.ok(html.includes("Rust → Lean translation was not rerun"));
  assert.ok(html.includes("Materialized tree"));
  assert.ok(!html.includes("independently reproduced"));
});

test("patched reproduction prepares the recorded nested package before building and auditing", async () => {
  const { renderRecordedRun } = await import("../web/recorded-run");
  const s = sarif();
  s.runs[0].properties.proofs.toolchain_input = {
    manifest_path: "workspace/crate/Cargo.toml",
  };
  s.runs[0].properties.proofs.aeneas = {
    backend: "lean",
    audit_source: "import Proofs\n",
  };
  const report = {
    id: 3,
    revision_no: 2,
    run_ids: [s.runs[0].automationDetails.guid],
    claims: [],
  };
  const html = renderRecordedRun(s, report.run_ids[0], 0, report);
  const prepare = html.indexOf(
    "cargo proofs prepare --manifest-path report-3-source-1/workspace/crate/Cargo.toml",
  );
  assert.ok(prepare > 0);
  assert.ok(prepare < html.indexOf("cd report-3-source-1"));
  assert.ok(prepare < html.indexOf("lake build"));
  assert.ok(html.includes(toolchainLabel(fixture())));
});

 test("patched Charon is recorded without claiming extraction", () => {
 const s = sarif(); const t = s.runs[0].properties.proofs.toolchain;
 t.components.charon.source = {kind:"git_patch",repository:"https://github.com/AeneasVerif/charon",base_commit:base,patch:{path:"patches/charon.patch",sha256:"a".repeat(64)}};
 t.components.charon.materialized = {git_tree:base};
 assert.equal(readRecord(s).toolchain!.components.charon.source.kind,"git_patch");
 delete t.components.charon.materialized;
 assert.throws(() => readRecord(s));
 });

test("Charon-only patch preserves unpatched Aeneas identity", () => {
 const s = sarif(); const t = s.runs[0].properties.proofs.toolchain;
 t.components.aeneas.source = {kind:"git",repository:"https://github.com/AeneasVerif/aeneas",commit:base};
 t.components.charon.source = {kind:"git_patch",repository:"https://github.com/AeneasVerif/charon",base_commit:base,patch:{path:"patches/charon.patch",sha256:"a".repeat(64)}};
 t.components.charon.materialized = {git_tree:base};
 s.runs[0].tool.driver.fullName = `Aeneas ${base.slice(0,12)}`;
 assert.equal(readRecord(s).toolchain!.components.aeneas.source.kind,"git");
});
