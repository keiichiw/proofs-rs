# Publish Aeneas Lean proofs

Aeneas translates Rust, through Charon, into a functional model that can be
verified in Lean. `cargo proofs` records **committed Lean proofs of that model**,
using an explicit mapping from each public Rust API to a Lean theorem.

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

## 2. Map Rust APIs to Lean theorems

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

`api` is a public Rust callable path relative to the library. Use the actual
theorem's input assumptions as the precondition; `"true"` is appropriate only
when there are no additional input assumptions. Each theorem maps to one API.
Private APIs, ambiguous mappings, and duplicate mappings are rejected.
`lean_dir` is relative to `Cargo.toml` and defaults to `"."`.

## 3. Commit, record, and publish

Commit and push Rust source, `Cargo.lock`, `proofs.toml`, the generated Lean
model and proof sources, `lakefile.toml` (or `lakefile.lean`),
`lake-manifest.json`, and `lean-toolchain` together. Ignore `.lake/` and Lean
compiled artifacts such as `.olean` and `.ilean`; the recorder builds the
mapped modules from source in a detached checkout.

From the Lean project directory:

```sh
cd proofs
cargo proofs run --manifest-path ../Cargo.toml -- lake build
cargo proofs publish --manifest-path ../Cargo.toml --dry-run
cargo proofs publish --manifest-path ../Cargo.toml
```

Sign in with `cargo proofs login` before publishing if needed. The tool revision
must be registered and selectable on the service. Changes to mappings or
preconditions require another recording.

## What a recorded result establishes

The recorder builds every mapped module explicitly, then checks that each
mapped name is a Lean theorem. The transitive axiom audit allows only `propext`,
`Classical.choice`, and `Quot.sound`. It rejects `sorryAx`, custom axioms
(including axiomatized external models), missing theorems, and failed builds.
The evidence links to the committed Lean module, and SARIF contains the exact
audit and logs. The report's reproduction commands include both build and audit.

The checked result is the named Lean theorem under the allowed axioms.
Charon/Aeneas extraction is **not rerun** by the recorder. In the report,
explain why the model matches the Rust commit, why the theorem describes the
selected API, what it guarantees, and how the precondition relates to the
theorem's assumptions. Review the specification's strength as well as the proof.

The current adapter supports the default Cargo configuration, ordinary module
paths (`Proofs/Increment.lean` for `Proofs.Increment`), and the official pinned
Aeneas Git dependency. It does not support custom Lake source directories,
local-path Aeneas dependencies, feature/target-specific extraction, or the Coq,
F*, and HOL4 backends. See the [version's limitations](/tool-version/aeneas-be86ab0f1989d04944292b345b24c435be3ad10a)
and [CLI documentation](https://github.com/proofs-rs/proofs-rs/tree/main/cli#aeneas-lean).
