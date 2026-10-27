# Add findings

This page is for Report authors. Only a Report's author can create or change its
findings. If you found something while reading another author's Report, comment
on that Report instead; see [Discuss a report](discuss-a-report.md) and
[Get help and give feedback](get-help.md).

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

### Associate APIs

Related APIs can be specified by public Rust paths in `proofs.toml`:

```toml
[[report.findings]]
title = "Empty input behavior"
body = "Describe the observed behavior here."
api_paths = ["my_crate::parse", "my_crate::Parser::parse"]
```

`api_paths` is optional (up to 50 paths). Each path must resolve uniquely in the
report's crate and version. Publication resolves paths to API IDs and deduplicates
aliases; an unresolved or ambiguous path prevents publication. Preview displays
these associations and warns about unresolved paths. This applies to initial
publication only; edit published findings through the Web/API.

## Edit published findings

On a report you authored, open **Add finding** immediately below Overview. Findings
have permanent IDs and detail pages at `/finding/<id>`. Report anchors such as
`/report/6#finding-<id>` remain available. Open the detail page and use **Edit** to correct
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

Withdrawn reports remain readable but cannot receive new findings or updates. Past report revisions show
current finding information, its origin revision, and update time, separately from
the proof content of that revision. The crate page lists findings for the selected
version only, above the API catalog. A summary links to the findings, APIs, and
reports for that version; each finding row links to its source report and supporting
evidence. It does not infer effects on other versions. Invalid, duplicate, and
withdrawn findings are excluded from normal counts but remain in report history.

## How findings appear

Report pages show a compact Findings list with titles, statuses and related APIs.
Open a finding's title to read its full description, reproduction, supporting links
and change history on `/finding/:id`. Authors edit findings on that detail page.
Local preview also provides finding detail pages, including unpublished drafts.

The report's **APIs** section includes APIs referenced by either claims or findings.
Each API lists its claim links and finding links; APIs with findings but no claims
are included. A finding does not automatically invalidate a claim: the claim's
specific contract and the finding's circumstances must be compared.

## Programmatic access

Findings can also be created and edited through the HTTP API, including an
optional `findings` array on initial report creation. See
[API documentation](api-documentation.md#findings).
