# Start here

proofs.rs is a public archive of formal verification results for Rust crates
published on crates.io. Each result is a Report about one version of one crate.
It contains Claims about individual APIs, together with the assumptions,
limitations, recorded runs, and discussion needed to judge them.

Verification results are often published far from the crates they concern, or
not at all. proofs.rs keeps them in one place, organized by crate, version, and
API. You can check what has been verified about a dependency before relying on it,
and publish your own results without changing the upstream project. See
[Why proofs.rs](introduction.md) for the motivation and policy.

## What a report does and doesn't tell you

- **Publication is not certification.** A Report is the author's evidence, made
  public so that others can scrutinize it. proofs.rs does not certify that it is
  correct or sufficient for your use.
- **A recorded run is not an independent reproduction.** The service stores the
  author's execution record; it does not rerun the verification.
- **A Claim covers one API under stated assumptions.** It is not a guarantee for
  the whole crate, for other versions, or for your application. A Report available
  for a dependency does not mean that the dependency as a whole is verified.

## Where to go next

- **Find and read verification results.** Search [Crates](/crates) for a crate you
  use, or browse recent [Reports](/reports). Then follow
  [Find and read a report](read-a-report.md) to decide what the evidence covers.
- **Publish your own results.** Start with
  [Publish your first report](publish-a-report.md).
- **Ask a question or give feedback.** See
  [Get help and give feedback](get-help.md) to find the right place for questions
  about a report, problems with the service, and private requests.
