/** Recorded source provenance. Observations and file locations are not source identities. */
export type Source =
  | { kind: "git"; repository: string; commit: string }
  | {
      kind: "git_patch";
      repository: string;
      base_commit: string;
      patch: { path: string; sha256: string };
    }
  | { kind: "release"; release_id: string };
export type Component = {
  tool: string;
  source: Source;
  materialized?: { git_tree: string };
};
export type Observation =
  | {
      kind: "dependency_resolved";
      dependency_name: string;
      subdirectory: string;
    }
  | { kind: "process_executed"; reported_version: string }
  | { kind: "not_run" };
export type Toolchain = {
  schema_version: 1;
  components: Record<string, Component>;
  uses: { component: string; role: string; observation: Observation }[];
};

export function normalizeRepository(repository: string): string {
  // Accept spelling variants, never credentials, alternate protocols, queries or fragments.
  const match =
    /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)\/?$/i.exec(
      repository,
    );
  if (!match) throw new Error("invalid_toolchain_repository");
  return `https://github.com/${match[1].toLowerCase()}/${match[2].replace(/\.git$/i, "").toLowerCase()}`;
}

export function sourceIdentity(component: Component): string {
  const s = component.source;
  return JSON.stringify(
    s.kind === "release"
      ? [component.tool, s.kind, s.release_id]
      : s.kind === "git"
        ? [
            component.tool,
            s.kind,
            normalizeRepository(s.repository),
            s.commit.toLowerCase(),
          ]
        : [
            component.tool,
            s.kind,
            normalizeRepository(s.repository),
            s.base_commit.toLowerCase(),
            s.patch.sha256.toLowerCase(),
          ],
  );
}

export function toolchainSourceIdentity(toolchain: Toolchain): string {
  const identities = Object.values(toolchain.components).map(sourceIdentity);
  const roles = toolchain.uses.map((use) => {
    if (!Object.hasOwn(toolchain.components, use.component))
      throw new Error("unknown_toolchain_component");
    return JSON.stringify([
      use.role,
      sourceIdentity(toolchain.components[use.component]),
    ]);
  });
  return JSON.stringify([identities.sort(), roles.sort()]);
}

/** Adapter capability checks, separate from the general wire format. */
export function validateAeneasToolchain(
  toolchain: Toolchain,
  driver: { name: string; version: string; fullName?: string },
  contracts: { formal?: { translation_rerun: boolean } }[],
): void {
  const invalid = () => {
    throw new Error("unsupported_aeneas_toolchain");
  };
  if (
    driver.name.toLowerCase() !== "aeneas" ||
    Object.keys(toolchain.components).sort().join(",") !==
      "aeneas,charon,lean" ||
    toolchain.uses.length !== 4
  )
    invalid();
  const { aeneas, charon, lean } = toolchain.components;
  if (
    !aeneas ||
    !charon ||
    !lean ||
    aeneas.tool !== "aeneas" ||
    charon.tool !== "charon" ||
    lean.tool !== "lean"
  )
    invalid();
  if (
    !(["git", "git_patch"].includes(aeneas.source.kind)) ||
    !aeneas.materialized ||
    !(["git", "git_patch"].includes(charon.source.kind)) ||
    (charon.source.kind === "git" ? charon.materialized !== undefined : !charon.materialized) ||
    lean.source.kind !== "release" ||
    lean.materialized !== undefined
  )
    invalid();
  if (
    aeneas.source.kind === "release" ||
    charon.source.kind === "release" ||
    lean.source.kind !== "release"
  )
    return invalid();
  const release =
    /^leanprover\/lean4:v(\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?)$/.exec(
      lean.source.release_id,
    );
  if (!release) invalid();
  if (
    normalizeRepository(aeneas.source.repository) !==
      "https://github.com/aeneasverif/aeneas" ||
    normalizeRepository(charon.source.repository) !==
      "https://github.com/aeneasverif/charon" ||
    (aeneas.source.kind === "git" ? aeneas.source.commit : aeneas.source.base_commit).toLowerCase() !== driver.version.toLowerCase()
  )
    invalid();
  if (driver.fullName !== toolchainLabel(toolchain))
    throw new Error("invalid_patched_tool_descriptor");
  const expected = new Map([
    ["aeneas:lean_library", "dependency_resolved"],
    ["aeneas:translator", "not_run"],
    ["charon:rust_frontend", "not_run"],
    ["lean:proof_checker", "process_executed"],
  ]);
  for (const use of toolchain.uses) {
    const key = `${use.component}:${use.role}`;
    if (
      !Object.hasOwn(toolchain.components, use.component) ||
      expected.get(key) !== use.observation.kind
    )
      invalid();
    expected.delete(key);
    if (use.observation.kind === "process_executed") {
      const reported = /^Lean \(version ([^,\s)]+)(?:,|\))/.exec(
        use.observation.reported_version.trim(),
      );
      if (!reported || reported[1] !== release![1])
        throw new Error("inconsistent_lean_version");
    }
    if (
      use.observation.kind === "dependency_resolved" &&
      (use.observation.dependency_name !== "aeneas" ||
        use.observation.subdirectory !== "backends/lean")
    )
      invalid();
  }
  if (
    expected.size ||
    !contracts.length ||
    contracts.some((c) => c.formal?.translation_rerun !== false)
  )
    invalid();
}

/** All legacy remains valid. Once patched, every Run must describe the same sources. */
export function compareToolchains(toolchains: (Toolchain | undefined)[]): void {
  if (toolchains.every((t) => t === undefined)) return;
  if (toolchains.some((t) => t === undefined))
    throw new Error("mixed_patched_and_legacy_runs");
  let identity: string | undefined;
  const trees = new Map<string, string>();
  for (const toolchain of toolchains as Toolchain[]) {
    const current = toolchainSourceIdentity(toolchain);
    if (identity !== undefined && identity !== current)
      throw new Error("inconsistent_run_toolchain_sources");
    identity = current;
    for (const component of Object.values(toolchain.components)) {
      if (!component.materialized) continue;
      const source = sourceIdentity(component),
        tree = component.materialized.git_tree.toLowerCase();
      if (trees.has(source) && trees.get(source) !== tree)
        throw new Error("inconsistent_materialized_tree");
      trees.set(source, tree);
    }
  }
}

/** Shared public/preview descriptor; resolve by tool/source rather than component ID. */
export function toolchainLabel(
  toolchain: Pick<Toolchain, "components">,
): string {
  const component = Object.values(toolchain.components).find(
    (c) => c.tool === "aeneas",
  );
  if (!component || component.source.kind === "release")
    return "Recorded toolchain";
  if (component.source.kind === "git") return `Aeneas ${component.source.commit.toLowerCase().slice(0, 12)}`;
  return `Aeneas ${component.source.base_commit.toLowerCase().slice(0, 12)} + patch ${component.source.patch.sha256.toLowerCase().slice(0, 12)}`;
}
