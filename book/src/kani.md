# Record with Kani

This page covers what is specific to Kani. Follow
[Publish your first report](publish-a-report.md) for the common steps.

## From start to finish

Run these inside the crate, with your contract harnesses already passing under
`cargo kani -Z function-contracts`. The links after the commands explain each step.

```sh
cargo install cargo-proofs --locked                 # 1. Install
cargo proofs init --tool kani --tool-version 0.68.0 # 2. Create proofs.toml
git add proofs.toml Cargo.lock && git commit -m "Add proofs.rs configuration" && git push
cargo proofs login                                  # 3. Sign in
cargo proofs run -- cargo kani -Z function-contracts # 4. Record
cargo proofs preview                                # 5. Preview
cargo proofs publish --dry-run && cargo proofs publish # 6. Publish
```

Steps: [Install](publish-a-report.md#1-install),
[Create proofs.toml](publish-a-report.md#2-create-proofstoml),
[Sign in](publish-a-report.md#3-sign-in),
[Record](publish-a-report.md#4-record-verification),
[Preview](publish-a-report.md#5-preview),
[Publish](publish-a-report.md#6-publish). Use a version listed on
[Kani](/tool/kani) in place of `0.68.0`.

For a finished example, compare [Report #5](/report/5) with its
[source repository](https://github.com/nyuichi/even-or-odd-verification): one
contract harness for `is_even` becomes one Claim, the `proofs.toml` prose
becomes the Overview, and the recorded run appears under Evidence.

## Which harnesses become Claims

`cargo proofs` discovers `#[kani::proof_for_contract(...)]` harnesses and
publishes one Claim per target API. The target's `requires` predicates become the
Claim's preconditions; with no `requires`, the precondition is `true`.

```rust
#[cfg_attr(kani, kani::requires(x < u32::MAX))]
pub fn increment(x: u32) -> u32 {
    x + 1
}

#[cfg(kani)]
#[kani::proof_for_contract(increment)]
fn check_increment() {
    let x: u32 = kani::any();
    increment(x);
}
```

- **Ordinary `#[kani::proof]` harnesses are not published.** Their target and
  scope cannot be inferred safely from arbitrary code, so discovery prints
  `Note: N ordinary #[kani::proof] harness(es) are not publication targets.` To
  publish such a result, express it as a function contract with a
  `proof_for_contract` harness.
- **One contract harness per API.** Several contract harnesses for one API, or an
  ambiguous target, stop publication.
- **Source-level discovery.** Discovery parses source; it does not expand macros.
  Macro-generated functions or harnesses, glob imports, and `include!` source
  trees are not resolved. Integration-test targets are not scanned.
- **Public API only.** The target must resolve to exactly one API in the crate's
  public API catalogue. Trait implementation methods are written as
  `<Type as Trait>::method`.

A harness may restrict inputs, concrete types, stubs, or loop bounds beyond the
extracted `requires`. Describe those restrictions in the Report's
`trusted_assumptions` or `limitations`; readers cannot see them in the Claim's
preconditions.

## Set up and record

```sh
cargo proofs init --tool kani
cargo proofs run -- cargo kani -Z function-contracts
```

Function contracts are an unstable Kani feature, so `-Z function-contracts` is
required. `cargo proofs` does not add it for you.

`init` can detect the installed Kani version. Pass features and the target after
`--`, for example `cargo proofs run -- cargo kani -Z function-contracts --features foo`. Discovery
evaluates `cfg` with `kani`, those features, and the target.

Use regular serial Kani output. Quiet or terse output, parallel jobs, and options
that disable safety checks are rejected. Harnesses that did not execute produce no
Claims; unreachable checks remain labeled unreachable.

Continue with [Preview and publish](publish-a-report.md#5-preview).
