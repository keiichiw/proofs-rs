# Concepts and terminology

## Report

A Report is the unit in which verification results are published and discussed. It concerns one version of one crate and groups together the verification tool and version used, an explanation of the verification, assumptions, limitations, evidence, and individual Claims.

## Claim

A Claim is a verification statement about a particular API. For example, it may state that, under the specified assumptions and within the stated verification scope, the API does not exhibit undefined behavior or panic. A Claim is not a comprehensive guarantee about the crate as a whole.

## Tool

A Tool represents the verification tool used. Known limitations are recorded by version and are kept separate from assumptions or limitations specific to an individual Report. Supported tools currently include Kani, Creusot, and Aeneas with Lean; see [Tools](/tools) for registered versions and their limitations.

## Discussion

Comments allow public questions, objections, and responses concerning a Report. Discussion takes place at the Report level. Updates to a Report are preserved as Revisions, so earlier versions remain available for reference.

## Reproduce

Reproduce provides the information needed to rerun a verification, including the relevant Git commit, invocation, tool version, check results, and logs. Execution records are stored in SARIF format, while verification source code is referenced by a specific commit in an external repository. These records describe the contributor’s execution; they do not imply that proofs.rs has independently reproduced the result. In the future, the service may add automated reproduction or AI-assisted checks.

## Dependencies

A Report's Dependencies section lists the published crate version's direct
dependencies from crates.io, including build, development, optional, and
target-specific dependencies. It shows version requirements rather than a
resolved dependency graph; transitive dependencies are not expanded. The list
describes the crates.io release, which may differ from a verification fork or
the packages compiled in a recorded run.

The right column links to public Reports for versions satisfying each dependency's
requirement. An em dash (—), as in the APIs list, means no matching public Report
is available. Report availability does not mean that the dependency was reviewed
by this Report's author or that all of its APIs are verified. Read the linked
Report for its scope, assumptions, and limitations.

An author can declare dependency reviews: each pins one evidence Report revision
for a dependency the author relied on. Reviewed links are marked in the list. A
review is the author's declaration, not an independent certification. See
[Declare dependency reviews](review-a-dependency.md) for how reviews are checked
and displayed.

## Glossary

| Term | Meaning |
| --- | --- |
| Revision | A published version of a Report. Each `cargo proofs publish` that changes a Report creates a revision; earlier revisions stay readable at `?v=<revision>`. |
| Withdrawn | The author has withdrawn the Report. It remains readable, with a notice, but cannot be updated or receive new Findings. Links that pinned it show its withdrawal. |
| Hidden | Removed from public view by moderation. Links to hidden evidence show it as unavailable. |
| Finding | Something the author learned during verification, such as a bug, a useful precondition, or a specification ambiguity. See [Add findings](findings.md). |
| Finding validity | The author's assessment of a Finding: `reported`, `confirmed`, `disputed`, `invalid`, or `duplicate`. Invalid and duplicate Findings are excluded from normal counts but remain in history. |
| Upstream status | How a Finding has been handled by the crate's maintainers, as reported by the author: `not_reported`, `reported_upstream`, `fix_proposed`, `fix_merged`, `released`, or `wont_fix`. proofs.rs does not synchronize it with GitHub. |
| Reviewed | On a dependency link, the author declared that they read that evidence Report revision. It does not mean the dependency is fully verified. |
| — (em dash) | In API and dependency lists, no matching public Report is available. |
| What is trusted / Technical limitations | Page labels for the `trusted_assumptions` and `limitations` fields. Technical limitations also include the tool version's known limitations. |
