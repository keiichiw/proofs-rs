# Configuration and Markdown

`proofs.toml` lives next to the crate's `Cargo.toml`. `cargo proofs init` creates
it; the crate name and version come from Cargo metadata, so there is no `[crate]`
section.

## proofs.toml reference

| Section | Key | Required | Meaning |
| --- | --- | --- | --- |
| `[report]` | `title` | Yes | Report title. Plain text. |
| `[report]` | `explanation` | No | Shown as **Overview**. Markdown. |
| `[report]` | `trusted_assumptions` | No | Shown as **What is trusted**. Markdown. |
| `[report]` | `limitations` | No | Shown as **Technical limitations**. Markdown. |
| `[report]` | `environment` | No | Shown under **Reproduce › Environment**. Markdown. |
| `[[report.findings]]` | `title`, `body`, `api_paths` | No | Findings created with a new Report. See [Add findings](findings.md). |
| `[tool]` | `name` | Yes | `kani`, `creusot`, or `aeneas`. |
| `[tool]` | `version` | Yes | The tool version used. Must be registered on [Tools](/tools). |
| `[tool]` | `target` | Creusot only | `annotated` or `all`. See [Record with Creusot](creusot.md). |
| `[tool]` | `lean_dir`, `proof_modules`, `translation_manifest` | Aeneas only | See [Record with Aeneas and Lean](aeneas.md). |
| `[[tool.proofs]]` | `api`, `module`, `theorem`, `precondition` | Aeneas only | Explicit theorem mappings. |
| `[git]` | `remote` | No | Source remote name. Defaults to `origin`; must be a GitHub repository. |
| `[dependencies]` | `<package> = { report, revision }` | No | Dependency reviews. See below. |

When revising a Report, omitted optional `[report]` fields keep their published
text, and an explicitly empty value (`""`) clears it.

## Limits

- Up to 200 Claims and 128 KiB per Report; Kani discovery supports up to 100 APIs.
  Each Aeneas theorem counts as one Claim. Reports are not split automatically.
- A recorded SARIF file can be up to 8 MiB.
- Up to 20 findings with a new Report; titles up to 1,000 characters and bodies
  up to 10,000; up to 50 `api_paths` per finding.

## Markdown in reports

The report fields `explanation`, `trusted_assumptions`, `limitations`, and
`environment` support Markdown. Claim explanations, trusted assumptions, and
limitations support the same formatting, including inherited report context.
Titles, preconditions, tool limitations, and comments remain plain text.

Use headings, emphasis, lists, links, blockquotes, inline or fenced code, tables,
and strikethrough. Single line breaks are preserved. Raw HTML is displayed as
text, images are disabled, and unsafe link schemes are rejected. Code blocks
have no syntax highlighting.

Headings are relative to their container: `#` becomes a subsection (`h3`) within
preset sections such as **Overview**, **What is trusted**, and **Technical limitations**.
Report and claim explanations appear inside **Overview**, keeping author-written
headings subordinate to the site's preset sections.
Deeper headings stop at `h6`. This formatting also applies to existing revisions.

Use TOML multiline literal strings to preserve Markdown and backslashes:

````toml
[report]
title = "Contract verification of my crate"
explanation = '''
# Verified behavior

The implementation preserves **ordering**.

```rust
assert!(result.is_sorted());
```
'''
trusted_assumptions = '''
# Allocator

- Allocation succeeds.
- Inputs satisfy the documented contract.
'''
````

## Field names and page labels

Pages display `trusted_assumptions` as **What is trusted** and `limitations` as
**Technical limitations**. The configuration and JSON keys keep their original
names. Report-level fields describe the whole Report; Claim-level fields
describe one Claim. Tool limitations are maintained separately on
[Tools](/tools) and shown alongside the Report's own limitations.

## Dependency reviews

For a walkthrough from choosing evidence to inspecting the published list, see
[Declare dependency reviews](review-a-dependency.md).

You may add fixed evidence references to `proofs.toml`:

```toml
[dependencies]
serde = { report = 123, revision = 2 } # Placeholder numbers: replace with your evidence
```

Use the dependency's actual Cargo package name, including when your manifest uses
an alias. Its version comes from report 123, revision 2. It must match the same
crates.io package in the selected run's saved Cargo metadata. Git and path forks
are not interchangeable with crates.io releases. You can leave other dependencies
unlisted; if several versions occur, only the referenced report's version counts.

Adding a review or changing its evidence revision needs no new run. A dependency
change needs a new run, using committed Cargo.lock and the verifier's features and
target. `publish --dry-run` shows review changes. Omit the entire section to keep
previous reviews when updating a report; retain an empty `[dependencies]` section
to remove all reviews. An empty list means zero reviewed dependencies, not zero
crate dependencies. Missing, hidden, withdrawn, or mismatched evidence blocks
publication, including with `--force`.

## Source repositories with submodules

Recording automatically restores all submodules recursively at the Gitlink commits
in the recorded source revision, before Cargo metadata and API discovery. This
applies to every supported verifier; submodules are optional. Relative submodule
URLs resolve against the selected source remote. No remote branches are followed.
An inaccessible repository or missing commit stops recording. Git transport
restrictions are retained; the recorder does not enable the file protocol.

Submodule snapshots use an isolated temporary clone so initialization cannot alter
the original checkout's Git configuration. Recording checks pinned HEADs and tracked
files before and after verification, and removes the snapshot on success or failure.
Reproduction instructions initialize submodules after checking out the source commit.

## Aeneas cumulative patches

Only Aeneas accepts optional `[tool].patch = "proofs/toolchain/aeneas.patch"`.
The path is relative to the selected package containing `proofs.toml`; it must be
a regular file inside the proof repository, without symlink traversal. The
recorded path is repository-relative. `version` remains a registered official
full Aeneas base SHA. Users do not write `toolchain.components` or `uses`.

Run `cargo proofs prepare` before configuring Lake's path dependency and its first
`lake update`. Prepare uses the selected package and `lean_dir`, restoring into
`.proofs-toolchain/aeneas/`; ignore that directory. See the
[Aeneas patch guide](aeneas.md#use-a-cumulative-aeneas-patch) for the require entry,
initial workflow and update steps. Patches cannot change Charon/Lean pins or Lake
package/dependency configuration, add submodules/symlinks, inject `.lake/` or Lean
compiled artifacts, or use arbitrary repositories and preparation hooks.
