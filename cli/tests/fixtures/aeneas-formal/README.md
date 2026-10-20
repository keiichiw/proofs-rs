# Real Aeneas fixture

`lib.rs` was translated using Charon 0.1.291 (pin
08d7c9d50144bd84848212c24701253585e90d1f) and Aeneas
be86ab0f1989d04944292b345b24c435be3ad10a on 2026-10-19:

```sh
charon cargo --preset=aeneas --dest-file formal_fixture.llbc -- --lib
aeneas -backend lean -emit-json -dest . formal_fixture.llbc
```

FormalFixture.lean and translation.json are the unmodified translator output.
Proofs.lean contains independently checked specs: a reference model in the
postcondition and a specialized zero argument. Lean 4.35.0 is pinned.
Run `cargo test real_formal_extraction -- --ignored` from cli; optionally set
PROOFS_TEST_AENEAS_CACHE to a Lake package with these exact cached dependencies.
The tests build sources and execute the real extraction, not a JSON mock.
