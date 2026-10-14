# Concepts

## Report

A Report is the unit in which verification results are published and discussed. It concerns one version of one crate and groups together the verification tool and version used, an explanation of the verification, assumptions, limitations, evidence, and individual Claims.

## Claim

A Claim is a verification statement about a particular API. For example, it may state that, under the specified assumptions and within the stated verification scope, the API does not exhibit undefined behavior or panic. A Claim is not a comprehensive guarantee about the crate as a whole.

## Tool

A Tool represents the verification tool used. Known limitations are recorded by version and are kept separate from assumptions or limitations specific to an individual Report.

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

An author can declare dependency reviews. Each review pins one evidence Report
revision and its crate version. The service checks that this package was present
in the recorded Cargo dependency resolution; it does not independently certify
the author's judgment or claim that every resolved package was compiled during
verification. Reviewed links are marked in the list. Reviews that are outside
the published direct dependency requirements remain under Other reviewed evidence.

The `n reviewed dependencies` count in Report summaries is the number of declared
dependency reviews, not the total dependency count or a measure of crate coverage.
A count of zero means no dependency reviews were declared.

Reviewed evidence does not automatically follow newer Report revisions. If an
evidence Report is later withdrawn, its pinned link remains and shows its current
withdrawal. Hidden evidence has no public link. If crates.io metadata cannot be
loaded, the section shows that the dependency list is unavailable rather than
implying that the crate has no dependencies.
