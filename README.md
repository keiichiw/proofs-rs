# proofs.rs

- [Website](https://proofs.rs)
- [Book](https://proofs.rs/book/)
- [Zulip](https://proofs-rs.zulipchat.com/)
- [CLI](cli/README.md)
- [Development](docs/development.md)
- [Announcement](https://proofs-rs.hashnode.dev/announcing-proofs-rs-a-public-registry-for-rust-formal-verification-results)

This repository contains the source for [proofs.rs](https://proofs.rs), a public registry for Rust formal verification results. It includes the website and service, the `cargo proofs` publishing CLI, and the proofs.rs book.

A Report records an author's verification results for one version of a crate, with Claims about individual APIs, assumptions, limitations, evidence, and discussion. Publication is not certification: proofs.rs does not independently rerun verification. Authors can publish independently of the upstream project, and small, well-scoped results are welcome.

The service runs on Cloudflare Workers with Hono and TypeScript. The [development guide](docs/development.md) covers local setup, tests, and deployment; its [local UI demo](docs/development.md#local-ui-demo) provides seeded scenarios for working on the interface. The CLI lives in `cli/`, and the book source lives in `book/`.
