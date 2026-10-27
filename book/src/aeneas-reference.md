# Aeneas evidence details

This page is a reference for the Aeneas adapter's recorded evidence and
implementation. For setup and publishing, see
[Record with Aeneas and Lean](aeneas.md).

## Recorded formal evidence

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

## Claim identity across revisions

When publishing revisions, the CLI matches claims by API and theorem name, so
reordering specifications or recording a new run preserves each claim's ID and
prose. Adding a theorem creates a claim; removing one follows the usual claim
deletion confirmation. If an API has exactly one old and one new claim, its ID
can also be retained across a theorem rename or migration from a legacy recording.
With multiple claims, unmatched theorems get new IDs rather than inheriting another
theorem's text. Locally saved publication state can restore a removed theorem's ID.

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
