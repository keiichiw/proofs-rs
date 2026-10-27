# Preview a report locally

Use `cargo proofs preview` to review your report as a reader before publishing.
It combines `proofs.toml`, a successful recorded verification run, and existing
report text when revising a report. The browser displays the report, individual
claims, reproduction instructions, logs, and a SARIF download using the UI bundled
with your installed CLI.

## Start the preview

Install Node.js 24 or newer alongside a CLI version that includes `preview`.
Other CLI commands do not require Node.js. No npm installation is needed to use
the installed CLI.

From the crate directory, after `cargo proofs run` has recorded verification:

```sh
cargo proofs preview
```

The command prints a URL such as `http://127.0.0.1:54321/report` and opens it in
your browser. The port is selected automatically; the server is accessible only
on your computer. Stop it with Ctrl+C.

For another workspace or a fixed local port:

```sh
cargo proofs preview --manifest-path path/to/crate/Cargo.toml --port 8080 --no-browser
```

Use `-p NAME` to select a package in a workspace. `--no-browser` prints the URL
without opening a browser. If a fixed port is already in use, choose another or
omit `--port`.

## Review the report and claims

Every page is marked **Local preview — not published**. Under **Verified APIs**,
click an API name or **Claim #…** to open the local claim page. Check its title,
preconditions, explanation, evidence, assumptions, and limitations, including the
shared report context. Use the report link to return to the overview.

Report-to-claim navigation, recorded-run pages, and SARIF downloads stay on
localhost. Tool details, dependency evidence, and the API catalogue link within
a claim open the selected remote service. An unresolved API name has no catalogue
link; its **Claim #…** link still opens locally.

Edit the report fields, including optional `[[report.findings]]` entries with
`title` and Markdown `body`, in `proofs.toml`, save, and reload the browser. Changes to
prose do not require another verification run. A configuration error appears as an
error page; correct it and reload. The preview has no browser-based editor,
publication button, comments, or stars.

## Select a run or revise an existing report

By default, preview selects the latest local run when it starts and keeps that
selection until restart. Recording another run does not silently switch the
open preview. Select one explicitly with:

```sh
cargo proofs preview --run <RUN_UUID>
```

The run must match the package version and tool configuration. A missing or failed
run cannot be previewed as publishable evidence. Preview does not run verification.

With valid saved credentials, the CLI selects the same saved publication target
as `publish`. To preview an existing public report explicitly, including without
login:

```sh
cargo proofs preview --report 123
```

Replace `123` with your report ID. The report must target the same crate/version.
Omitted optional report fields preserve existing Web text; explicitly empty
values clear it. Claim text is preserved by matching APIs, while preconditions
and evidence come from the recorded run. Local claim pages show this proposed
content, including when the claims already have permanent published IDs.

For an existing report, preview shows its published findings. Local
`report.findings` is used only for initial publication; later additions and edits
use the website or Findings API. See [Add findings](findings.md).

New reports need no login. If saved authentication is unavailable, automatic
report selection is unavailable too: preview explains that it is showing a new
report unless you supplied `--report`. To read another service, pass `--server
ORIGIN` or set `PROOFS_SERVER`.

## Understand warnings and publication checks

Missing or ambiguous API metadata is marked unverified. The recorded API path
remains visible, but a signature or existing claim match is not guessed. Missing
tool details and dependency evidence are also identified. Pinned dependency
reviews are shown; the full direct-dependency catalogue is unavailable locally.

A changed server revision, claims absent from the draft, a withdrawn report, or
an interrupted publication is reported without changing publication state.
Preview does not resolve these publication conditions for you.

| Command                          | What it does                                                                                                  |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `cargo proofs preview`           | Opens the local reader UI; only GET requests to the service; no upload or publication-state updates           |
| `cargo proofs publish --dry-run` | Prints prospective publication data; requires authentication and may prepare the API catalogue on the service |
| `cargo proofs publish`           | Uploads the recorded SARIF, performs final validation, and publishes or revises the report                    |

The UI matches the CLI release you installed. To pick up a newly built or installed
UI bundle, stop and restart preview; browser reload refreshes report data only.
For source-checkout instructions, see the [CLI documentation](https://github.com/proofs-rs/proofs-rs/blob/main/cli/README.md#local-report-preview).
