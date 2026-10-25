# Report a finding

A finding is a short account of something learned during verification: an API
behavior, a useful precondition, a specification ambiguity, a limitation, or a bug.
Write the title and Markdown body in English. Include only observations that add
information beyond the report body; do not repeat its overview, assumptions, or
limitations as separate findings. Code blocks and links are supported; no fixed
expected/actual/reproduction sections are required. Keep enough context here to
understand the observation without following a link. Detailed investigation and
fix discussions can live in an upstream issue. Failure to prove a property alone
is not evidence of a bug.

## Write findings in proofs.toml

Add optional findings to the existing report draft:

```toml
[[report.findings]]
title = "A precondition worth documenting"
body = '''
The property requires **nonempty input**.
See the linked issue for the discussion of the API contract.
'''
```

Each entry needs a nonempty `title` (up to 1,000 characters) and `body` (up to
10,000 characters). Up to 20 entries can accompany an initial report. Omit the
array when there are no findings. No separate file or directory is required.

`cargo proofs preview` displays these drafts after Overview. Save the TOML and
reload to review edits; prose changes do not require a new verification run.
The first `cargo proofs publish` creates the report, claims, and findings together.
When updating an existing report, the CLI leaves findings unchanged and explains
that local `report.findings` is only used for new reports. Preview then displays
published findings, including edits made on the website. Use the Web/API to add or
edit findings after publication; the CLI does not synchronize or repost this array.

## Edit published findings

On a report you authored, open **Add finding** immediately below Overview. Findings
have permanent IDs and links such as `/report/6#finding-<id>`. Use **Edit** to correct
the finding or update its optional status. These changes create finding events without
creating a new report revision. **Change history** opens the full history, including
removed links. The finding's origin revision is the current report revision when
it is registered, even if you are viewing an older revision.

Use **Add issue or PR link** after contacting upstream. Links can also reference a
commit, release, or revalidation report. Release links require the fixed version.
Revalidation links require a public, active report for the same crate, its revision,
and its canonical `https://<site>/report/<id>?v=<revision>` URL. A revalidation link
records evidence; it does not automatically declare the bug fixed.

Optional metadata can associate APIs, evidence links, and issue/fix status with a
finding. New findings do not display the initial status badges. Validity and
upstream status are independent. Validity is `reported`, `confirmed`,
`disputed`, `invalid`, or `duplicate`. A duplicate requires another visible finding
ID. Self references and cycles are rejected; clearing a duplicate also requires
clearing its target ID.

Upstream status is author reported; proofs.rs does not synchronize GitHub state.
Add a supporting link before changing the status:

| Status              | Required live evidence          |
| ------------------- | ------------------------------- |
| `not_reported`      | None                            |
| `reported_upstream` | Issue or PR                     |
| `fix_proposed`      | PR                              |
| `fix_merged`        | PR or commit                    |
| `released`          | Release link with fixed version |
| `wont_fix`          | Issue or PR                     |

To remove the last supporting link, first change the upstream status or add
replacement evidence. Removing a link preserves it in history.

Only the report's author can create or change findings. Withdrawn reports remain
readable but cannot receive new findings or updates. Past report revisions show
current finding information, its origin revision, and update time, separately from
the proof content of that revision. The crate page lists findings for the selected
version only, above the API catalog. A summary links to the findings, APIs, and
reports for that version; each finding row links to its source report and supporting
evidence. It does not infer effects on other versions. Invalid, duplicate, and
withdrawn findings are excluded from normal counts but remain in report history.

## API

All paths below are relative to `/api/v1`. See the live [API reference](/api/docs)
for schemas, authentication, and response codes. Session writes require Origin,
CSRF, and current terms acceptance; publish tokens can also operate these APIs.

| Method | Path                              | Purpose                                                                       |
| ------ | --------------------------------- | ----------------------------------------------------------------------------- |
| GET    | `/reports/:id/findings`           | Paginated report findings, including historical invalid and duplicate entries |
| POST   | `/reports/:id/findings`           | Create a finding at the report's latest revision                              |
| GET    | `/findings/:id`                   | Content, live links, APIs, and ordered event history                          |
| PATCH  | `/findings/:id`                   | Edit content, APIs, validity, or upstream status                              |
| POST   | `/findings/:id/links`             | Add supporting evidence                                                       |
| DELETE | `/findings/:id/links/:link_id`    | Soft delete a link                                                            |
| GET    | `/crates/:name/:version/findings` | Paginated active findings for exactly one version                             |

Creation requests need an `Idempotency-Key` header (16–100 letters, digits, `_`, or
`-`). Reuse the key and exact request body when retrying; a changed body returns 409. PATCH and link operations require the current `edit_version` integer. Every
successful change, including a link operation, increments that version. A stale
version returns 409; reload the finding before editing again. Removed links cannot
support a status. URLs must use HTTPS without embedded credentials. The server
does not fetch supplied URLs.

A minimal creation body:

```json
{
  "title": "Empty input panics",
  "body": "`parse(&[])` panics, although an empty result is expected."
}
```

Initial `POST /reports` and `/reports/validate` accept an optional `findings` array
(up to 20 entries) of the same bodies. Report, claims, and findings commit together.
Claims and successful recorded runs remain required. Report revisions reject
`findings`; use the independent APIs to add or change them. Finding edits and
link changes retain their own history without changing the report revision.
