---
name: write-proofs-report
description: Write or revise proofs.rs verification reports for Rust crate and API users deciding what they can rely on. Use when drafting report explanations, assumptions, limitations, or proofs.toml editorial fields from verification artifacts, or rewriting process-heavy reports into evidence-backed guarantees and remaining risks.
---

# Write a proofs.rs report

Write for a Rust developer deciding whether to use the crate or API, without assuming verifier knowledge. Answer: **What behavior is established, why is the evidence meaningful, under what conditions, and what remains uncertain?** Use the requested language; default to English for public proofs.rs contributions.

## 1. Inspect the evidence

Read the source, contracts or harnesses, recorded verification results, and run configuration. Follow relevant evidence links; old report prose and tool READMEs are claims to check. If only summaries are accessible, attribute claims to them and identify material missing evidence separately. Never imply you inspected or reran unavailable artifacts.

Keep a working inventory, not a report appendix:

- Exact crate version, source revision, public APIs, target, features, input domains, preconditions, callbacks, dependencies, and harness bounds. Distinguish arbitrary inputs from finite tests or bounded models.
- Relationship to the crates.io release: executable adaptations, verification-only changes, and evidence connecting the verified implementation to the published one. Matching names and versions do not establish equivalence.
- Behavioral specifications and successful results supporting each guarantee, including relevant callee bodies and their composition. Proving a caller against helper contracts does not prove the helpers. Distinguish body proofs, trusted contracts, specifications, source review, tests, and archived runs. Associate claims with the right source and run; do not combine differing scopes into a fictitious complete run.
- Material assumptions and uncovered behavior. An absent assumption list does not establish absence of assumptions; zero dependency reviews does not establish absence of dependencies.
- Whether the toolchain was patched: check the actual wrapper and configuration, not only the advertised tool version. If patched, follow the active compiler/model patches, overlays, and custom solver drivers to their rationale, diffs, and validation. Distinguish semantic changes, added or strengthened assumptions, proved lemmas, and proof-search changes.

When evidence is insufficient or contradictory, narrow the claim and state the gap. Do not invent proofs, diagnoses, bugs, or historical reviews. Ask only to resolve material uncertainty; otherwise deliver a qualified draft. Do not rerun expensive proofs merely to write the report.

## 2. Explain the behavior

Lead with what the crate/API does and the useful guarantee. When helpful, orient an unfamiliar user in one or two sentences: inputs, operation, and result. Describe concrete supported behavior, including boundary values and important error cases. Prefer “For every input in [domain], [API] returns [result]” to “exact functional contracts were verified.” Examples illustrate established claims; they are not proof.

Cover distinct useful properties actually established, including panic freedom when supported; do not lose a secondary guarantee while explaining output correctness. Keep the boundaries precise:

- State panic freedom over the proved domain and dependencies/callbacks. Inspect the panic specification or generated obligations when needed; an annotation or successful native no-panic check alone does not establish a formal guarantee. Distinguish termination, panics, aborts, and allocation failures when relevant.
- Separate output correctness from complete memory safety. Proving bounds, initialization, or UTF-8 preconditions at an unsafe call does not discharge all Rust undefined-behavior obligations.
- Describe repeated-call guarantees only when initialization and invariant preservation support them.
- Preserve domain distinctions: exact hash outputs do not establish collision resistance; parser state-table conformance alone does not establish format conformance.

Translate formulas accurately. Preserve widths, powers, bounds, signedness, and quantifiers when paraphrasing; if plain words would change the meaning, retain a short exact formula.

Do not invent confidence percentages, security ratings, or adoption verdicts. Avoid unqualified “safe,” “fully verified,” “cannot crash,” or “production-ready.”

## 3. Explain why the qualifications are acceptable

Put conditions that change the opening guarantee beside it. Make the verified source and target clear, while reserving concrete details for their primary home below. Do not repeat the same fork/trust warning throughout the report.

For material **trusted operations**, explain their mechanism, what the caller proves, what remains assumed, and which guarantee depends on that assumption. Give the concrete source-based argument or other evidence for accepting the boundary when available: relevant layout, bounds, borrowing, value-preservation, or other invariants. A reasoned review can justify narrow trust without being a formal proof. Label your own source reasoning as such; never claim a historical audit occurred without evidence. “Trusted helper” or “permissions unproved” alone does not let the reader assess the boundary.

For material **crate adaptations**, explain what executable behavior changed, why verification needed the change, and the evidence or reasoning that it preserves the relevant behavior. “Small change,” “safe Rust,” or an unexplained “modified fork” is insufficient. State whether equivalence to the published implementation was formally established; source reasoning is not formal equivalence. A patched verifier alone does not mean the crate source is a modified fork.

Only when the **toolchain is patched**, include a concise reader-facing account of **why the patch was needed, what it changed, and why verification with it supports this report's guarantees**. Link the implementation and validation. Substantiate correspondence to Rust semantics, derivation of helper lemmas from identified assumptions, or unchanged logical statements under trigger edits. Inspect active driver transformations as well as compiler patches. Passing verification or adding no axioms alone does not establish model adequacy. State remaining validation gaps; do not imply unmodified tools reproduce the result. For unpatched tools, leave routine versions, configuration, and generic tool caveats to existing environment/evidence references.

For remaining gaps, explain which user question is unanswered. Distinguish formal proof under assumptions, tests or source reasoning, unestablished properties, and observed failures. Do not turn an unproved property into a vulnerability or trust into a defect. Include only gaps that affect interpretation; keep resolved development failures and unrelated hypothetical risks in evidence artifacts.

## 4. Compose the report

Aim for a short account understandable without opening artifacts. Give each fact one primary home. Allow concise paragraphs needed to understand the API, source adaptations, trust, and patched tools; do not force them into a fixed word budget. Keep detailed commands, revisions, solver logs, goal counts, phase histories, scratch paths, and proof-development difficulty in evidence/reproduction material.

Use the destination's schema and supported format. For current proofs.rs editorial fields, use these roles. `report.title` is plain text; the other fields render Markdown:

- `report.title`: behavior and scope; a straightforward correctness title is appropriate when the body supports it and states qualifications clearly.
- `report.explanation`: API orientation, concrete guarantees and essential conditions; if tools were patched, their rationale, changes, and evidence-based justification.
- `report.trusted_assumptions`: material assumed behavior, mechanism, acceptance argument, and consequences.
- `report.limitations`: source adaptations and their justification, relationship to the release, target restrictions, and unanswered questions.
- `report.environment`: concise run configuration and reproduction/evidence references, including patch revisions when applicable.

For a standalone report, use the same order, combining sections when a short scope makes them redundant, and add exact evidence links. If the user supplies a successful report as a reference, retain its useful structure and explanatory depth while checking its claims against the evidence; do not copy outdated facts or unsupported assurances.

Preserve unrelated configuration, dependency reviews, tool settings, contracts, and evidence. Do not invent fields, inflate claims, or fabricate SARIF. In Markdown fields, use headings, emphasis, lists, links, blockquotes, inline or fenced code, tables, and strikethrough only where they aid reading. Headings nest under the page's preset sections, so start at `#`. Raw HTML is shown as text and images are disabled. Use TOML multiline literal strings (`'''`) to preserve Markdown and backslashes. Parse any edited TOML to check syntax. Writing a report alone does not authorize publication, proof/code changes, or rerunning verification; follow the user's actual authorized scope.

## 5. Review as a crate user

Before delivering, check:

- Is the API and concrete guarantee clear, including useful secondary properties?
- Can the reader tell whether their release, target, features, inputs, and callbacks are covered?
- Does each guarantee match inspected source/specifications and results, or explicitly attributed summaries, with precise mathematical meaning?
- Can they assess why source adaptations, trusted boundaries, and any tool patches are acceptable, while distinguishing reasoning from formal proof and seeing remaining gaps?
- Are material conditions visible, facts stated once, and routine tool details omitted from prose when unpatched?
- Can they find evidence without reading a proof-development history?

Deliver the report and only material evidence gaps or review notes. Do not append the working inventory or checklist.
