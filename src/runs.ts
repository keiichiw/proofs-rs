import {
  resolveContract,
  checkAnchor,
  formalSourceLinks,
  validLeanSegments,
} from "../web/formal-evidence";
import { operation } from "./openapi";
import * as S from "./schemas";
import { Hono } from "hono";
import {
  App,
  Ctx,
  Env,
  Fault,
  requireUser,
  one,
  stmt,
  batch,
  quota,
  text,
  now,
  rows,
} from "./core";

export const runs = new Hono<App>();
const SARIF_LIMIT = 8 * 1024 * 1024;
const id = (s: string) => {
  if (!S.runId.safeParse(s).success) throw new Fault(400, "invalid_run_id");
  return s;
};
const relative = (s: unknown) =>
  typeof s === "string" &&
  s.length > 0 &&
  s.length <= 1000 &&
  !s.startsWith("/") &&
  !s.includes("\\") &&
  !s.split("/").includes("..") &&
  !/[\x00-\x1f:]/.test(s);
const digest = async (bytes: ArrayBuffer) =>
  Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
async function visibleRun(c: Ctx) {
  const run = await one(
    c.env.DB,
    "SELECT * FROM verification_runs WHERE id=?",
    id(c.req.param("run") || ""),
  );
  if (!run) throw new Fault(404, "run_not_found");
  const published = await one(
    c.env.DB,
    "SELECT 1 FROM report_runs rr JOIN reports p ON p.id=rr.report_id WHERE rr.run_id=? AND p.visibility='public' LIMIT 1",
    run.id,
  );
  if (!published && run.author_id !== c.get("user")?.id)
    throw new Fault(404, "run_not_found");
  return run;
}
export function validateSarif(s: any) {
  if (!S.sarif.safeParse(s).success) throw new Fault(400, "invalid_sarif");
  const r = s.runs[0];
  const artifacts = r.artifacts || [];
  if (!Array.isArray(artifacts)) throw new Fault(400, "invalid_sarif");
  const streams = new Set<number>();
  for (const name of ["stdout", "stderr", "stdoutStderr"]) {
    const loc = r.invocations[0][name];
    if (loc === undefined) continue;
    if (
      !Number.isInteger(loc?.index) ||
      loc.index < 0 ||
      typeof artifacts[loc.index]?.contents?.text !== "string"
    )
      throw new Fault(400, "embedded_log_required");
    streams.add(loc.index);
  }
  if (!streams.size) throw new Fault(400, "embedded_log_required");
  for (const [i, artifact] of artifacts.entries()) {
    if (
      !artifact ||
      typeof artifact !== "object" ||
      (artifact.contents !== undefined &&
        (!artifact.contents ||
          typeof artifact.contents !== "object" ||
          !streams.has(i) ||
          Object.keys(artifact.contents).some((k) => k !== "text")))
    )
      throw new Fault(400, "embedded_source_not_allowed");
  }
}
export function readRecord(sarif: any) {
  validateSarif(sarif);
  const s = sarif.runs[0],
    inv = s.invocations[0],
    p = s.properties?.proofs;
  if (
    p?.schemaVersion !== 2 ||
    !Array.isArray(s.versionControlProvenance) ||
    s.versionControlProvenance.length !== 1
  )
    throw new Fault(400, "invalid_proofs_sarif");
  const keys = new Set<string>();
  for (const dependency of p.dependencies) {
    const key = JSON.stringify([
      dependency.crate,
      dependency.version,
      dependency.source,
    ]);
    if (keys.has(key)) throw new Fault(400, "duplicate_run_dependency");
    keys.add(key);
  }
  const provenance = s.versionControlProvenance[0];
  const b = {
    id: id(s.automationDetails?.guid),
    crate: text(p.crate, "Crate", 100, true),
    version: text(p.version, "Version", 100, true),
    source: validateSource({
      repository: provenance?.repositoryUri,
      commit: provenance?.revisionId,
    }),
    command: [
      inv.executableLocation?.uri,
      ...(Array.isArray(inv.arguments) ? inv.arguments : []),
    ],
    working_directory:
      typeof inv.workingDirectory?.uri === "string"
        ? inv.workingDirectory.uri.replace(/\/$/, "")
        : undefined,
    started_at: inv.startTimeUtc,
    finished_at: inv.endTimeUtc,
    exit_code: inv.exitCode,
    execution_successful: inv.executionSuccessful,
    contracts: p.contracts,
    dependencies: p.dependencies,
  };
  if (!Array.isArray(inv.arguments)) throw new Fault(400, "invalid_command");
  if (
    !relative(b.working_directory) ||
    !Array.isArray(b.command) ||
    b.command.length < 1 ||
    b.command.length > 200 ||
    typeof b.command[0] !== "string" ||
    !b.command[0].trim() ||
    b.command.some(
      (x: any) => typeof x !== "string" || x.length > 4000 || x.includes("\0"),
    )
  )
    throw new Fault(400, "invalid_command");
  if (
    !Number.isFinite(Date.parse(b.started_at)) ||
    !Number.isFinite(Date.parse(b.finished_at)) ||
    Date.parse(b.finished_at) < Date.parse(b.started_at) ||
    (b.exit_code !== null && !Number.isInteger(b.exit_code)) ||
    typeof b.execution_successful !== "boolean"
  )
    throw new Fault(400, "invalid_run_times");
  if (
    !Array.isArray(b.contracts) ||
    !b.contracts.length ||
    b.contracts.length > S.MAX_REPORT_CLAIMS
  )
    throw new Fault(400, "invalid_run_contracts");
  const formalRun = b.contracts.some((c: any) => c.formal !== undefined);
  if (
    formalRun &&
    new Set(b.contracts.map((c: any) => c.harness)).size !== b.contracts.length
  )
    throw new Fault(400, "duplicate_formal_harness");
  for (const contract of b.contracts) {
    if (
      !contract ||
      !relative(contract.file) ||
      !Number.isInteger(contract.first_line) ||
      contract.first_line < 1 ||
      !Number.isInteger(contract.last_line) ||
      contract.last_line < contract.first_line ||
      typeof contract.harness !== "string" ||
      !Array.isArray(contract.api_paths) ||
      !contract.api_paths.length ||
      contract.api_paths.some((p: any) => typeof p !== "string") ||
      typeof contract.precondition !== "string"
    )
      throw new Fault(400, "invalid_run_contract");
  }
  for (const contract of b.contracts) {
    if (contract.formal !== undefined) {
      const f = contract.formal;
      if (
        s.tool.driver.name.toLowerCase() !== "aeneas" ||
        f.theorem !== contract.harness ||
        f.source.file !== contract.file ||
        f.source.first_line !== contract.first_line ||
        f.source.last_line !== contract.last_line ||
        !relative(f.source.file) ||
        f.definitions.some(
          (d: any) =>
            d.source &&
            (!relative(d.source.file) ||
              d.source.last_line < d.source.first_line),
        ) ||
        f.axioms.some(
          (a: string) =>
            !["propext", "Classical.choice", "Quot.sound"].includes(a),
        ) ||
        (f.mapping === "manifest" &&
          (!f.manifest ||
            !relative(f.manifest.path) ||
            !f.program ||
            !f.program_head ||
            f.manifest.entry.lean_name !== f.program_head ||
            !contract.api_paths.includes(f.manifest.entry.rust_name) ||
            f.manifest.entry.loop != null ||
            f.manifest.entry.parent_lean_name != null ||
            !relative(f.manifest.entry.lean_file) ||
            f.manifest.entry.source.end_line <
              f.manifest.entry.source.begin_line)) ||
        (f.mapping === "manual" && f.manifest !== null) ||
        (f.conclusion_segments !== undefined &&
          !validLeanSegments(f.conclusion, f.conclusion_segments)) ||
        f.binders.some(
          (b: any) =>
            b.type_segments !== undefined &&
            !validLeanSegments(b.type, b.type_segments),
        )
      )
        throw new Fault(400, "invalid_formal_evidence");
      if (
        !s.results.some(
          (r: any) =>
            r.properties?.harness === contract.harness &&
            r.ruleId === "aeneas.lean.theorem" &&
            r.kind === "pass",
        )
      )
        throw new Fault(400, "unverified_formal_evidence");
    }
    const matches = s.results.filter(
      (r: any) => r.properties?.harness === contract.harness,
    );
    if (
      !matches.length ||
      matches.some(
        (r: any) =>
          !["pass", "notApplicable", "informational"].includes(r.kind),
      )
    )
      throw new Fault(400, "unverified_contract");
  }
  if (!b.execution_successful || b.exit_code !== 0)
    throw new Fault(400, "unsuccessful_run");
  return b;
}
async function readStored(c: Ctx, run: any) {
  const object = await c.env.ARCHIVE.get(run.r2_key);
  if (!object) throw new Fault(503, "sarif_unavailable");
  return object;
}
runs.post(
  "/:run/sarif",
  ...operation("Upload a recorded verification run", S.uploadedRun, {
    tags: ["Runs"],
    params: { run: S.runId },
    body: S.sarif,
    raw: true,
    media: "application/sarif+json",
    status: 201,
    additionalResponses: { 200: S.uploadedRun },
    auth: "user",
    write: true,
    errors: [400, 404, 409, 413, 428, 429],
    description:
      "Uploads original SARIF bytes (maximum 8 MiB). Identical uploads return 200; new runs return 201. The run ID must match automationDetails.guid.",
  }),
  async (c) => {
    const u = requireUser(c),
      run = id(c.req.param("run") || "");
    const bytes = await c.req.arrayBuffer();
    if (!bytes.byteLength || bytes.byteLength > SARIF_LIMIT)
      throw new Fault(413, "artifact_too_large");
    const sha = await digest(bytes);
    const existing = await one(
      c.env.DB,
      "SELECT * FROM verification_runs WHERE id=?",
      run,
    );
    if (existing) {
      if (existing.author_id !== u.id || existing.sha256 !== sha)
        throw new Fault(409, "immutable_run");
      return c.json({ id: run, sha256: sha }, 200);
    }
    let sarif;
    try {
      sarif = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      throw new Fault(400, "invalid_sarif");
    }
    const record = readRecord(sarif);
    if (record.id !== run) throw new Fault(400, "run_id_mismatch");
    const driver = sarif.runs[0].tool.driver;
    const tv = await one(
      c.env.DB,
      "SELECT v.id FROM tool_versions v JOIN tools t ON t.id=v.tool_id WHERE lower(t.name)=lower(?) AND v.version=? AND v.selectable=1 AND t.active=1",
      driver.name,
      driver.version,
    );
    if (!tv) throw new Fault(400, "tool_version_unavailable");
    // Each attempt owns its object, so compensation cannot delete a concurrent winner.
    const key = `runs/${u.id}/${run}/${crypto.randomUUID()}.sarif.json`;
    await c.env.ARCHIVE.put(key, bytes, {
      httpMetadata: { contentType: "application/sarif+json" },
    });
    try {
      await batch(c.env.DB, [
        quota(c.env.DB, u.id, "verification_run", 90),
        stmt(
          c.env.DB,
          "INSERT INTO verification_runs(id,author_id,crate,version,tool_version_id,sha256,size,r2_key,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
          run,
          u.id,
          record.crate,
          record.version,
          tv.id,
          sha,
          bytes.byteLength,
          key,
          now(),
        ),
        ...record.dependencies.map((d: any) =>
          stmt(
            c.env.DB,
            "INSERT INTO run_dependencies(run_id,crate,version,source) VALUES(?,?,?,?)",
            run,
            d.crate,
            d.version,
            d.source,
          ),
        ),
      ]);
    } catch (error) {
      // A lost DB response may still have committed. Never delete that live object.
      const saved = await one(
        c.env.DB,
        "SELECT * FROM verification_runs WHERE id=?",
        run,
      );
      if (saved?.r2_key !== key) await c.env.ARCHIVE.delete(key);
      if (saved?.author_id === u.id && saved.sha256 === sha)
        return c.json({ id: run, sha256: sha });
      if (saved) throw new Fault(409, "immutable_run");
      throw error;
    }
    return c.json({ id: run, sha256: sha }, 201);
  },
);
runs.get(
  "/:run",
  ...operation("Read verification run metadata", S.run, {
    tags: ["Runs"],
    params: { run: S.runId },
    auth: "optional",
    description: "Unpublished runs are visible only to their author.",
    errors: [400, 404],
  }),
  async (c) => {
    const r = await visibleRun(c);
    return c.json({
      id: r.id,
      author_id: r.author_id,
      crate: r.crate,
      version: r.version,
      tool_version_id: r.tool_version_id,
      sha256: r.sha256,
      size: r.size,
      created_at: r.created_at,
      dependencies: await rows(
        c.env.DB,
        "SELECT crate,version,source FROM run_dependencies WHERE run_id=? ORDER BY crate,version,source",
        r.id,
      ),
    });
  },
);
runs.get(
  "/:run/sarif",
  ...operation("Download a verification run as SARIF", S.sarif, {
    tags: ["Runs"],
    params: { run: S.runId },
    auth: "optional",
    responseMedia: "application/sarif+json",
    errors: [400, 404, 503],
  }),
  async (c) => {
    const run = await visibleRun(c),
      object = await readStored(c, run);
    c.header("Content-Type", "application/sarif+json");
    c.header(
      "Content-Disposition",
      `attachment; filename="${run.id}.sarif.json"`,
    );
    c.header("Content-Security-Policy", "default-src 'none'; sandbox");
    return c.body(object.body);
  },
);
// Reclaim crash leftovers only. Completed but unpublished runs remain valid records.
export async function cleanupRunUploads(env: Env) {
  let cursor: string | undefined;
  do {
    const page = await env.ARCHIVE.list({
      prefix: "runs/",
      cursor,
      limit: 1000,
    });
    for (const object of page.objects) {
      if (object.uploaded.getTime() > Date.now() - 86400000) continue;
      if (
        !(await one(
          env.DB,
          "SELECT 1 FROM verification_runs WHERE r2_key=?",
          object.key,
        ))
      )
        await env.ARCHIVE.delete(object.key);
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
}
export function validateSource(source: any) {
  // Immutable external Git source; no source content is accepted or retained.
  if (
    !source ||
    typeof source.repository !== "string" ||
    !/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(
      source.repository,
    ) ||
    typeof source.commit !== "string" ||
    !/^[a-f0-9]{40}$/.test(source.commit)
  )
    throw new Fault(400, "invalid_source_reference");
  return { repository: source.repository, commit: source.commit };
}
export async function validateReportRuns(c: Ctx, b: any, v: any) {
  if (
    !Array.isArray(b.run_ids) ||
    !b.run_ids.length ||
    b.run_ids.length > 10 ||
    new Set(b.run_ids).size !== b.run_ids.length
  )
    throw new Fault(
      400,
      "recorded_run_required",
      "Run cargo proofs run before publishing.",
    );
  const contracts: any[] = [];
  const records = new Map<string, any>();
  let source: string | undefined;
  for (const rid of b.run_ids) {
    const r = await one(
      c.env.DB,
      "SELECT * FROM verification_runs WHERE id=?",
      id(rid),
    );
    if (
      !r ||
      r.author_id !== requireUser(c).id ||
      r.crate !== v.crate ||
      r.version !== v.version ||
      r.tool_version_id !== v.tool_version_id
    )
      throw new Fault(400, "run_report_mismatch");
    const sarif = await (await readStored(c, r)).json();
    const m = readRecord(sarif);
    records.set(rid, sarif);
    if (source && source !== JSON.stringify(m.source))
      throw new Fault(400, "inconsistent_run_sources");
    source = JSON.stringify(m.source);
    contracts.push(...m.contracts);
  }
  for (const claim of v.claims) {
    if (claim.evidence_ref != null) {
      const sarif = records.get(claim.evidence_ref.run_id);
      if (
        !sarif ||
        !resolveContract(sarif, claim.evidence_ref.run_id, claim)?.formal
      )
        throw new Fault(400, "invalid_evidence_ref");
    } else if (
      !claim.precondition.trim() ||
      !contracts.some(
        (x) =>
          !x.formal &&
          x.api_paths.includes(claim.display_path) &&
          x.precondition === claim.precondition,
      )
    ) {
      throw new Fault(400, "claim_not_in_recorded_run");
    }
  }
  v.run_ids = b.run_ids;
}

/** Only detail requests load the referenced SARIF; lists retain the small revision reference. */
export async function claimFormalEvidence(c: Ctx, claim: any) {
  if (!claim.evidence_ref) return null;
  const ref = claim.evidence_ref;
  const run = await one(
    c.env.DB,
    "SELECT v.* FROM verification_runs v JOIN report_runs r ON r.run_id=v.id WHERE r.report_id=? AND r.revision_no=? AND v.id=?",
    claim.report_id,
    claim.report_revision,
    ref.run_id,
  );
  if (!run) throw new Fault(400, "invalid_evidence_ref");
  const sarif = await (await readStored(c, run)).json();
  const record = readRecord(sarif);
  const contract = resolveContract(sarif, ref.run_id, claim);
  if (!contract?.formal) throw new Fault(400, "invalid_evidence_ref");
  return {
    ...formalSourceLinks(
      contract.formal,
      record.source.repository,
      record.source.commit,
    ),
    check_url: `/runs/${ref.run_id}?report=${claim.report_id}&v=${claim.report_revision}#${checkAnchor(ref.harness)}`,
  };
}
