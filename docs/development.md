# Development

The service runs on Cloudflare Workers with Hono/TypeScript, D1, private R2,
Queues, Cron, Workers Assets, GitHub OAuth and optional Cloudflare Email Service.
See [backend design](backend-design.md) for the data model and
[operations](operations.md) for deployment and configuration.

## Local setup

Requires Node 24 and mdBook 0.4.45 (`cargo install mdbook --version 0.4.45 --locked`). `npm ci`, `npm run build`, `npm run db:local`, then `npm run dev`. Copy `.dev.vars.example` to `.dev.vars` and configure a development GitHub OAuth app to enable sign-in. Callback: `http://localhost:8787/auth/github/callback`. No local auth bypass is exposed by the Worker. `npm test` uses an in-memory SQLite adapter and fixture rustdoc JSON, never a live docs.rs request or email send.

`npm run typecheck`, `npm test`, and `npm run build` are required checks. The first migration creates immutable revisions, transaction guards, comment history, independent report/claim stars, comment votes, outbox events and delivery states. A keyset cursor is used for lists. The tool catalogue starts empty. Tools and versions are stored in D1 and can be added or updated through the audited admin API without a deployment.

## HTML pages

The Worker renders page content on the server (`src/site.ts` and `src/site-views.ts`).
Links and GET searches navigate normally; writes use POST forms backed by the existing
API validation, permissions, CSRF and idempotency checks. App JavaScript handles legacy hash URLs, version-selector submission and the
internal theme override. Use `?theme=base` for the plain view or `?theme=a` for
the document theme; selection persists in the same tab, including the Book. Personalized HTML is
not cached. The JSON API and CLI protocol retain their existing responses.

Crate searches, report lists, API claim lists, activity lists and stargazers use
keyset pagination links. Crate versions and API catalogues, report claims, complete
comment/reply trees and revision history, tool/version catalogues and active tokens
are included in the initial HTML. Home shows the latest 12 entries. Recorded run
summaries and reproduction commands are rendered with the report; complete logs
have a separate HTML page and remain available in the SARIF download.

## Book

The mdBook sources live in `book/src/`, with chapter order in `SUMMARY.md`.
`npm run build` builds the app first, then the book into `dist/book/`; the existing
static asset binding serves it at `/book/` (and redirects `/book` there).
`npm run build:book` rebuilds just the book. Preview through `npm run dev` to use
the same paths and security headers as deployment. The book build externalizes
mdBook’s inline scripts and styles to preserve the site’s Content Security Policy.
CI and deployment workflows install the same pinned mdBook version.

## Data and behavior

- First explicit preparation of a crate/version imports crates.io metadata plus one docs.rs rustdoc JSON; later publications reuse D1. Unsupported rustdoc formats fail closed. Supported formats: 60 and 61. No whole-registry crawl, no re-run of proofs, no HTML scraping fallback.
- Reports publish one crate/version and tool/version with 1–100 claims in one transaction. Claim API and IDs are immutable. Shared and individual fields are additive; empty claim titles are generated. Full-report revisions retain stars and history.
- Independent report/claim stars survive revisions. Only non-self report stars contribute to karma; one replaceable policy in `src/core.ts` supplies profile and list/detail scores.
- Comments belong only to reports. Removed claims keep permanent links to their historical report revision.
- Replies form an unbounded-depth tree; every reply level indents. Deleted comments retain a public tombstone and private history.
- Notifications arise only from new comments, deduplicate recipients and skip the author. Unknown send outcomes are not automatically retried.
- Admin APIs require current `ADMIN_GITHUB_IDS` membership. Existing API tokens are accepted for listed owners; browser writes retain session/CSRF checks, and all writes retain terms checks. Every moderation action and history read is audited. There is no public history endpoint.

## CLI authentication and API documentation

Open `/api/docs` for the API reference and `/openapi.json` for OpenAPI 3.1.
The fixed public client ID is `proofs-cli`. Start at `POST /auth/device/code`,
show the returned user code, open the verification URL, and poll
`POST /auth/device/token`. Tokens have publishing scope (plus admin API access while the owner is listed in `ADMIN_GITHUB_IDS`), expire after 90 days,
and can be revoked in Settings or through `POST /api/v1/tokens/revoke`.
The Rust CLI lives in [`cli/`](../cli/README.md) so API and client changes can be reviewed together.
Install it from this repository with `cargo install --path cli --locked` (Rust 1.91+).
CLI versions and future releases remain independent of service deployments.

The `CLI and service checks` workflow runs Rust formatting, tests, Clippy and a local
HTTP/Git end-to-end test on Linux/macOS, alongside service type checks, tests and build.
It does not deploy, publish a crate, or send reports to a running proofs.rs instance.

The Worker generates `/openapi.json` at request time from public Hono routes and their shared schemas (`src/openapi.ts`, `src/schemas.ts`). `/api/docs` uses Scalar. Add route-local `operation(...)` metadata when adding a public endpoint; admin routes remain ordinary Hono routes without metadata. No generated specification is checked in.
`hono-openapi` keeps the existing Hono handlers and JSON/form/raw-SARIF handling;
Zod schemas validate JSON/form inputs while handlers retain database-dependent rules.
The generator receives only the public router, so admin routes cannot enter the definition.
The test suite checks coverage against every non-administrative API/auth route,
validates OpenAPI structure, and checks fixture responses against generated schemas.
Scalar loads a pinned browser bundle from jsDelivr; its CSP allowance is limited to
`/api/docs`. The old `/docs/api` URL redirects there.

Recorded verification requires CLI 0.3.0: commit and push the source and Cargo.lock, then `cargo proofs run -- cargo kani ...` and `cargo proofs publish`. The service stores only SARIF 2.1.0 with embedded execution logs. Source remains at the recorded GitHub commit. Nothing generated by run needs a Git push. See [recording and reproduction](../cli/README.md#recording-and-reproduction).

## Crate API catalogue

The crate API endpoint now returns the complete catalogue (`next_cursor: null`),
with current claim counts for active public reports. Family rows sum
claim counts across their implementations; zero claims display as an em dash.
The Web UI groups functions, associated functions, inherent methods, and trait
implementations; blanket implementations are a separate subsection. Single
implementations link directly, while multiple implementations start collapsed.

## Reviewed dependencies

An optional `proofs.toml` section pins the report revision you reviewed for each
named dependency:

```toml
[dependencies]
serde = { report = 123, revision = 2 }
```

The evidence report supplies the crate version. Publication checks its crate and
version against the selected recorded run's Cargo dependency snapshot; only
crates.io sources are supported for this declaration. A Git or path fork with the
same name/version does not count as the crates.io package. Other dependencies may
remain undeclared, and multiple versions may be present: only the evidence
report's exact version is reviewed.

Reviews belong to the consuming report revision and are the report author's
judgment, not independent certification by proofs.rs. Evidence revisions stay
pinned when their report changes; current withdrawal is displayed on old reviews.
A hidden evidence report exposes no content. Changing reviews alone requires no
new run; changing dependencies requires a new recorded run. An omitted section
preserves reviews on update; an explicitly empty `[dependencies]` removes them.
Zero reviews does not mean the crate has zero dependencies.

For existing installations, see [the migration procedure](dependency-migration.md).
