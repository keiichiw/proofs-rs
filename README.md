# proofs.rs

A public registry for Rust formal verification results.

- [Website](https://proofs.rs)
- [Book](https://proofs.rs/book/)
- [CLI](cli/README.md)
- [Development](docs/development.md)

### Automatic Aeneas formal statements

Aeneas runs can resolve specifications using committed `-emit-json` output.
Set `proof_modules = ["Proofs"]` and
`translation_manifest = "Generated/translation.json"` under `[tool]` (paths
relative to `lean_dir`), then use the usual `cargo proofs run -- lake build`
and `cargo proofs publish`. Existing `[[tool.proofs]]` entries remain supported
and explicitly select among ambiguous candidates. New recordings capture the
full Lean proposition, typed binders, target expression, source and axiom audit;
Claim revisions refer to the recorded run and theorem, so editing prose cannot
change the displayed theorem. `precondition` prose may be omitted for these
records. Translation itself is not rerun by the recorder.

See [the Aeneas guide](https://proofs.rs/book/aeneas.html) for setup, scope,
provenance, limits, and the tested Lean 4.35.0 / Aeneas be86ab0f adapter.
