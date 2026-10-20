# Publish Aeneas Lean proofs

Aeneas translates Rust, through Charon, into a functional model that can be
verified in Lean. `cargo proofs` records **committed Lean proofs of that model**,
automatically resolving Rust APIs and specification theorems from Aeneas metadata, or using explicit mappings.

Requires Rust 1.91 or later and cargo-proofs 0.4.0 or later:

```sh
cargo install cargo-proofs --locked
```

## 1. Pin the registered Aeneas revision

The [Aeneas tool page](/tool/aeneas) lists registered revisions. The initial
registered revision is
[`be86ab0f1989d04944292b345b24c435be3ad10a`](https://github.com/AeneasVerif/aeneas/tree/be86ab0f1989d04944292b345b24c435be3ad10a),
which uses Lean 4.35.0. Use the same Aeneas revision to generate the model and
for the Lean library dependency. Use its compatible Charon pin as described in
the [upstream installation and extraction instructions](https://github.com/AeneasVerif/aeneas/tree/be86ab0f1989d04944292b345b24c435be3ad10a#usage).

For a Lean project in `proofs/` next to the Rust package's `Cargo.toml`, put
`leanprover/lean4:v4.35.0` in `proofs/lean-toolchain`. A minimal
`proofs/lakefile.toml` has:

```toml
name = "demo-proofs"

[[lean_lib]]
name = "Proofs"

[[require]]
name = "aeneas"
git = { url = "https://github.com/AeneasVerif/aeneas", subDir = "backends/lean" }
rev = "be86ab0f1989d04944292b345b24c435be3ad10a"
```

Run `lake update` in `proofs/` to resolve and write `lake-manifest.json`.
Generate the model and write proofs using Aeneas's instructions. The example
below assumes a proof module `proofs/Proofs/Increment.lean` containing a theorem
named `demo.increment_spec`; replace those names with your actual proof.

## 2. Select specification modules

Generate the committed model and mapping together, using the pinned translator:

```sh
charon cargo --preset=aeneas --dest-file model.llbc -- --lib --locked
aeneas -backend lean -emit-json -dest proofs/Generated model.llbc
```

Enable automatic resolution by specifying local proof entry modules:

```toml
[tool]
name = "aeneas"
version = "be86ab0f1989d04944292b345b24c435be3ad10a"
lean_dir = "proofs"
proof_modules = ["Proofs"]
translation_manifest = "Generated/translation.json"
```

The manifest path is relative to `lean_dir` and defaults to `translation.json`.
Commit it with the generated Lean, Rust and proofs. Entry modules and their
transitive imports are searched only where their sources belong to this Lake
package. Dependency packages such as Aeneas and Mathlib are excluded. Ordinary
helper theorems are ignored; recognized specifications with unresolved public
APIs produce diagnostics. Loop helpers are never treated as independent APIs.

If an API has several specification theorems, each becomes a separate claim with
its own assumptions, conclusion and recorded evidence. A theorem that applies
only to a specific argument remains separate from a universally quantified theorem.
Zero selected specifications is an error. There is no `discover` subcommand.

### Explicit selection and existing projects

From the Rust package directory:

```sh
cargo proofs init --tool aeneas --tool-version be86ab0f1989d04944292b345b24c435be3ad10a
```

Review the report fields and edit the generated `proofs.toml` tool section:

```toml
[tool]
name = "aeneas"
version = "be86ab0f1989d04944292b345b24c435be3ad10a"
lean_dir = "proofs"

[[tool.proofs]]
api = "increment"
module = "Proofs.Increment"
theorem = "demo.increment_spec"
precondition = "x < u32::MAX"
```

`api` is a public Rust callable path relative to the library. `precondition` is
optional author prose; existing text is retained. Empty prose means readers must
consult the proposition, including input types and type class instances. It does
not mean “no conditions.” Explicit mappings take precedence over automatic
resolution, and may select a theorem outside Aeneas's standard specification
shape. A manually selected theorem is never automatically assigned another API.
Projects without a translation manifest can continue to use only these mappings.
Each selected theorem maps to one public Rust callable. Multiple `[[tool.proofs]]`
entries may name the same API with different theorems. A manual mapping overrides
that theorem's automatic mapping; other specifications for the API are still included.
`lean_dir` is relative to `Cargo.toml` and defaults to `"."`.

When publishing revisions, the CLI matches claims by API and theorem name, so
reordering specifications or recording a new run preserves each claim's ID and
prose. Adding a theorem creates a claim; removing one follows the usual claim
deletion confirmation. If an API has exactly one old and one new claim, its ID
can also be retained across a theorem rename or migration from a legacy recording.
With multiple claims, unmatched theorems get new IDs rather than inheriting another
theorem's text. Locally saved publication state can restore a removed theorem's ID.

## 3. Commit, record, preview, and publish

Commit and push Rust source, `Cargo.lock`, `proofs.toml`, the generated Lean
model and proof sources, `lakefile.toml` (or `lakefile.lean`),
`lake-manifest.json`, and `lean-toolchain` together. Ignore `.lake/` and Lean
compiled artifacts such as `.olean` and `.ilean`; the recorder builds the
mapped modules from source in a detached checkout.

From the Lean project directory:

```sh
cd proofs
cargo proofs run --manifest-path ../Cargo.toml -- lake build
cargo proofs preview --manifest-path ../Cargo.toml
cargo proofs publish --manifest-path ../Cargo.toml --dry-run
cargo proofs publish --manifest-path ../Cargo.toml
```

The preview command requires Node.js 24 or newer. Review the report and each local
claim page, then stop the server with Ctrl+C before continuing. It reads the
recorded run without running Lean again. See [Preview a report](preview-a-report.md)
for editing prose, selecting another run, and interpreting warnings.

Sign in with `cargo proofs login` before publishing if needed. The tool revision
must be registered and selectable on the service. Changes to mappings or
preconditions require another recording.

## What a recorded result establishes

The recorder builds every mapped module explicitly, then checks that each
mapped name is a Lean theorem. The transitive axiom audit allows only `propext`,
`Classical.choice`, and `Quot.sound`. It rejects `sorryAx`, custom axioms
(including axiomatized external models), missing theorems, and failed builds.
SARIF stores version 1 formal evidence on each contract: the complete
pretty-printed `TheoremVal.type`, typed binders, conclusion, target expression
(including specialized arguments such as `f 0`), source range, audited axioms,
and mapping provenance. Manifest records include its SHA-256, reported translator
versions and the matched entry. At most 100 direct definition references are
included, with links for local definitions; bodies and recursive closures are
not copied. Expressions over 1,000,000 UTF-8 bytes, more than 1,000 binders, or
SARIF over 8 MiB fail explicitly instead of silently truncating statements.

New Claims carry `evidence_ref: {run_id, harness}` saved with each Claim revision.
The service checks that the reference belongs to that report revision, resolves
exactly one audited contract, and matches the API and theorem. Invalid explicit
references never fall back to text matching. Old records retain their old path.
The statement is stored only in SARIF, never in editable Claim prose or the DB.
Claim detail shows a Readable Lean view with `for all`, `assume`, `instance`,
and `then` rows, plus an expandable/copyable full proposition. New recordings
optionally include `type_segments` on binders and `conclusion_segments`, produced
by Lean's tagged pretty-printer. Each segment contains `text` and optionally a
Lean constant name in `ref`; concatenation must equal the corresponding plain
text. At most 10,000 segments and 1,000,000 UTF-8 bytes are accepted per expression.
Tagging failure falls back to plain text without affecting the checked statement.
Only references with recorded local sources become commit-pinned links; external
or unresolved definitions remain text. Older recordings use the same layout
without inline definition links. The author-stated Preconditions remain separate
from the extracted Lean hypotheses. Source and recorded-check links are retained. Publishing and previewing use the
selected recording, without extracting from the current working tree. The report's reproduction commands include both build and audit.

The checked result is the named Lean theorem under the allowed axioms.
Charon/Aeneas extraction is **not rerun** by the recorder. In the report,
explain why the model matches the Rust commit and any additional trusted boundaries.
The manifest is translation provenance, not evidence that translation was rerun or
that the committed Rust, manifest and Lean are synchronized. Review the specification's strength as well as the proof.

The current adapter supports the default Cargo configuration, ordinary module
paths (`Proofs/Increment.lean` for `Proofs.Increment`), and the official pinned
Aeneas Git dependency. It does not support custom Lake source directories,
local-path Aeneas dependencies, feature/target-specific extraction, or the Coq,
F*, and HOL4 backends. See the [version's limitations](/tool-version/aeneas-be86ab0f1989d04944292b345b24c435be3ad10a)
and [CLI documentation](https://github.com/proofs-rs/proofs-rs/tree/main/cli#aeneas-lean).

## Tested adapter and implementation

The adapter is tested with Lean **4.35.0** and Aeneas
**be86ab0f1989d04944292b345b24c435be3ad10a**. Other Lean/Aeneas API versions are
not yet verified. The generated `cli/tests/fixtures/aeneas-formal` model and
manifest were produced using this Aeneas version and Charon **0.1.291**
(pin **08d7c9d50144bd84848212c24701253585e90d1f**), then checked with real Lean.

Resolution reuses Aeneas `Utils.normalizeLetBindings` and
`Step.getStepSpecFunArgsExpr`; extraction uses Lean `forallTelescope`, `ppExpr`,
`findDeclarationRanges?`, and `collectAxioms`. The probe-aeneas manifest reader
was reviewed at `55db428974f6f0fca0cd22553d17436753d6398b`; its broader inventory
and enrichment dependencies are unnecessary for this small JSON adapter.

MachineChecked's `ProofLensProbe.lean` (`telescope`, `ppJson`, `linkRecord`,
`declRecord`) and Python `run_simple_probe` path were reviewed at
`9e713006b48e4b736e71e5e7fb38488f39ad60ee` (Apache-2.0). Its probe includes
paper-link requests, definition closure, navigation segments and hashing that
this recorder does not need. No MachineChecked code or Python runtime is
vendored: the small adapter uses Lean's public Meta APIs directly, preserving
the original forall prefix and leaving existentials in the conclusion. Upstream
Lean is Apache-2.0; Aeneas is used through the project's pinned dependency.
