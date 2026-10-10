# Report layout staging review

Open the [report-layout-demo catalogue](https://proofs-rs-staging.proofs-rs.workers.dev/crate/report-layout-demo?version=1.0.0-demo.1) and select a report by title. IDs change when affected staging fixtures are recreated; use the current catalogue links.

All fixtures are synthetic. No proof was run. Reproduction commands and source commits are illustrative, not executable proof instructions.

| Report | Checks |
| --- | --- |
| Layout demo — full | 7 API groups, 8 claim links, including two claims on decode; expanded trait groups; 55 revisions and 55 comments; two runs with SARIF downloads |
| Full report, revision 1 | Past revision indicator; claim links retain revision 1; reproduction remains present |
| Layout demo — minimal | No explanation, shared evidence, trust text, environment or runs; tool limitations still present; one API/claim |
| Layout demo — environment-only | Reproduce contains Environment despite no recorded run; no empty run/error output |
| Layout demo — withdrawn | Withdrawn notice and accessible history; excluded from active crate reports |

At desktop and at 600px/390px widths, check long API names and claim links. The right column groups claim links by API; mobile stacks them below the API name. Open the API and claim links to inspect titles, preconditions, explanations, trust, limitations and report revisions. Check execution details, diagnostics, environment and SARIF downloads in the full report.

The deployment workflow checks the public site, seeded report/claim pages, catalogue counts, recorded-run downloads and pagination. Signed-in interactions and viewport appearance remain manual review items; automated service tests cover authorization and revisions.

Fixture source: `scripts/build-staging-demo.py`. Regenerate with `python3 scripts/build-staging-demo.py`. Seeding is additive and repeatable. The one-time classification cleanup removes only affected reports and recorded runs plus their dependent records, retaining users, crates, API catalogues and tools before recreating current examples.
