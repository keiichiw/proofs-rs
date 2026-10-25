# Publish a report

Publish your verification reports with `cargo proofs`.

For Aeneas and Lean, follow [Publish Aeneas Lean proofs](aeneas.md).

## Getting started with Kani

### 1. Install

```sh
cargo install cargo-proofs --locked
```

Requires Rust 1.91 or newer.

### 2. Set up your report

Run inside the crate you verified.

```sh
cargo proofs init --tool kani
```

Discovers `#[kani::proof_for_contract(...)]` harnesses and creates one claim per API.

Edit `proofs.toml` to set the report title and check the tool version used for verification. You can also add an explanation, assumptions, limitations, and environment.
Optional `[[report.findings]]` entries contain a title and Markdown body and are
created with the initial report. See [Findings](findings.md) for an example and
editing after publication.

For help explaining what crate users can rely on, see [Write a useful report](write-a-report.md).
It includes a report-writing skill you can give your AI agent.

<details>
<summary>Example proofs.toml</summary>

```toml
[report]
title = "Contract verification of my crate"
# explanation = "What this report covers"
# trusted_assumptions = "Assumptions used in verification"
# limitations = "Scope restrictions"
# environment = "Verification environment"

[tool]
name = "kani"
version = "0.66.0" # Version used for verification
```

</details>

### Markdown in reports

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

### 3. Sign in

```sh
cargo proofs login
```

Authorize the CLI in your browser with your GitHub account.

### 4. Record, preview, and publish

Commit and push your source and Cargo.lock before recording verification.

```sh
cargo proofs run -- cargo kani
```

Only SARIF results with embedded logs are uploaded. Source stays on GitHub. No additional push is needed between run and publish.

With Node.js 24 or newer installed, review the report in your browser:

```sh
cargo proofs preview
```

Click an API name or **Claim #…** to inspect its local claim page. Edit
`proofs.toml` and reload the browser to review changes, then stop preview with
Ctrl+C. See [Preview a report](preview-a-report.md) for package/run selection,
existing reports, and missing metadata.

When ready, inspect the publication data and publish:

```sh
cargo proofs publish --dry-run
cargo proofs publish
```

The CLI prints a link to your published report. Run `cargo proofs publish` again to update the same report.

Using another tool? See [Tools](/tools) for supported tools and instructions.

[CLI documentation →](https://github.com/proofs-rs/proofs-rs/blob/main/cli/README.md)

### Field names and page labels

The pages display `trusted_assumptions` as **What is trusted** and `limitations` as **Technical limitations**. The JSON and CLI configuration keys remain unchanged. Report-level and claim-level fields retain their existing scope; tool limitations are maintained separately. This is a display-name change, not a change to the meaning or contents of existing reports.

### Declare dependency reviews

For a walkthrough from choosing evidence to inspecting the published list, see
[Review a dependency](review-a-dependency.md).

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

## Aeneas with Lean

Use cargo-proofs 0.4.0 or later to publish committed Aeneas Lean proofs with
explicit Rust API/theorem mappings. See [Publish Aeneas Lean proofs](aeneas.md)
for the registered revision, Lake configuration, proof mappings, recording and
publication commands, and the guarantees and limitations of the adapter.

### Source repositories with submodules

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

## Bugs discovered during verification

After publishing, use **Add finding** on your report to record a reproducible bug.
Issue and PR links can be added later without creating a report revision. See
[Report a finding](findings.md) for status evidence, duplicate management, and API
publication with an optional initial findings array.
