# API documentation

proofs.rs provides an HTTP API for reading and writing Reports, Claims, comments,
and Findings. The live [API reference](/api/docs) documents every endpoint, with
schemas, authentication, and response codes; the OpenAPI 3.1 description is at
[`/openapi.json`](/openapi.json).

`cargo proofs` uses this API. Its publish tokens expire after 90 days and can be
revoked in Settings.

## Findings

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
