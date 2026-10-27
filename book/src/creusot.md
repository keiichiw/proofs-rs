# Record with Creusot

This page covers what is specific to Creusot. Follow
[Publish your first report](publish-a-report.md) for the common steps.

## Set up and record

```sh
cargo proofs init --tool creusot --tool-target annotated --tool-version VERSION
cargo proofs run -- cargo creusot
```

Use the Creusot version you actually verified with; it must be registered on the
service. `init` tries `cargo creusot version` when `--tool-version` is omitted.
The resulting tool section looks like this:

```toml
[tool]
name = "creusot"
version = "VERSION"
target = "annotated" # required: "annotated" or "all"
```

`[tool].target` selects which APIs become Claims. It is unrelated to the Rust
compilation target, which you pass as `--target` after `--`.

## Which functions become Claims

- `annotated`: public free functions and concrete methods with `requires` or
  `ensures`.
- `all`: public free functions and concrete methods, even without these
  annotations. This selects source APIs; it does not attest that every function
  was verified.

Both exclude `trusted`, `logic`, `predicate`, `law`, and `check(ghost)` functions,
private items, and APIs without a public path. Trait declarations,
macro-generated APIs, and glob reexports are not discovered.

`requires` keeps its original Pearlite text as the Claim's precondition; several
predicates are joined with `&&`, and absence means `true`. `ensures` only selects
an API. Describe the verified behavior in the Report and Claim explanations.

## What a run must show

The prover run must create fresh `proof.json` sessions that map unambiguously to
the selected APIs. Compilation alone, unchanged stale sessions, unresolved proof
goals, and unsupported proof layouts do not certify an API. Review the tool
version's limitations on [Tools](/tools), including any panics outside the
verifier's coverage.

Continue with [Preview and publish](publish-a-report.md#5-preview).
