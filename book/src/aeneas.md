# Record with Aeneas and Lean

Aeneas translates Rust, through Charon, into a functional model that can be
verified in Lean. `cargo proofs` records **committed Lean proofs of that model**,
automatically resolving Rust APIs and specification theorems from Aeneas metadata, or using explicit mappings.

This page covers what is specific to Aeneas. The
[common steps](publish-a-report.md#common-steps) for signing in, previewing, and
publishing apply as well. Requires Rust 1.91 or later and cargo-proofs 0.4.0 or
later:

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
on this page uses this layout; replace the names with your actual proof:

```text
my-crate/
├── Cargo.toml
├── Cargo.lock
├── proofs.toml
├── src/lib.rs
└── proofs/
    ├── lean-toolchain
    ├── lakefile.toml
    ├── lake-manifest.json
    ├── Generated/            # Aeneas model and translation.json
    ├── Proofs.lean           # root module: import Proofs.Increment
    └── Proofs/
        └── Increment.lean    # theorem demo.increment_spec
```

Module names follow file paths: `Proofs/Increment.lean` is module
`Proofs.Increment`. With automatic selection from the `Proofs` entry module, the
root module `Proofs.lean` must import each proof module to be searched, for
example `import Proofs.Increment`. Custom Lake source directories are not
supported.

## 2. Create proofs.toml

From the Rust package directory (the one containing `Cargo.toml`):

```sh
cargo proofs init --tool aeneas --tool-version be86ab0f1989d04944292b345b24c435be3ad10a
```

The revision must be the full 40-character Aeneas commit in your Lake manifest.
Review the generated report fields, then choose how specifications are selected:
automatically from Aeneas metadata (next section), or with
[explicit mappings](#explicit-selection-and-existing-projects).

## 3. Select specifications automatically

Generate the committed model and mapping together, using the pinned translator:

```sh
charon cargo --preset=aeneas --dest-file model.llbc -- --lib --locked
aeneas -backend lean -emit-json -dest proofs/Generated model.llbc
```

Then edit the `[tool]` section of `proofs.toml` to name the proof entry modules:

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
Because `proof_modules = ["Proofs"]` names the root module, every module that
`Proofs.lean` imports, directly or transitively, is searched.

### Explicit selection and existing projects

Instead of, or in addition to, automatic resolution, edit the `[tool]` section
of the `proofs.toml` created in step 2 to map theorems to APIs explicitly:

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
`lean_dir` is relative to `Cargo.toml` and defaults to `"."`. For how Claim IDs
are kept when theorems are added, removed, or renamed, see
[Aeneas evidence details](aeneas-reference.md#claim-identity-across-revisions).

## 4. Commit, record, preview, and publish

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
recorded run without running Lean again. See [Preview a report locally](preview-a-report.md)
for editing prose, selecting another run, and interpreting warnings.

Sign in with `cargo proofs login` before publishing if needed. The tool revision
must be registered and selectable on the service. Changes to mappings or
preconditions require another recording.

## What a recorded result establishes

The recorder builds every mapped module explicitly, then checks that each
mapped name is a Lean theorem. The transitive axiom audit allows only `propext`,
`Classical.choice`, and `Quot.sound`. It rejects `sorryAx`, custom axioms
(including axiomatized external models), missing theorems, and failed builds.
The recorded SARIF stores each theorem's full proposition, which Claim pages show
as a Readable Lean view; see [Aeneas evidence details](aeneas-reference.md) for
the recorded evidence format.

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
