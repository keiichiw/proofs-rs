-- Register the shipped Aeneas Lean adapter in existing and new deployments.
-- Preserve any operator edits, including retirement of the tool or version.
INSERT INTO tools(id,name,description,official_url,active)
VALUES(
  'aeneas',
  'Aeneas',
  'Rust verification by functional translation. cargo-proofs 0.4.0+ records committed Lean proofs with explicit Rust API/theorem mappings and a transitive axiom audit.',
  'https://github.com/AeneasVerif/aeneas',
  1
) ON CONFLICT(id) DO NOTHING;

INSERT INTO tool_versions(id,tool_id,version,selectable,limitations,limitations_updated_at)
VALUES(
  'aeneas-be86ab0f1989d04944292b345b24c435be3ad10a',
  'aeneas',
  'be86ab0f1989d04944292b345b24c435be3ad10a',
  1,
  'Lean backend only, requiring cargo-proofs 0.4.0 or later. The version identifies the official Aeneas Git revision pinned in lake-manifest.json (backends/lean); this revision uses Lean 4.35.0. The recorder checks committed Lean theorem declarations and permits only propext, Classical.choice, and Quot.sound as transitive axioms. It rejects sorryAx and custom axioms, including axiomatized external models. Charon/Aeneas extraction is not rerun. The author must review that the committed functional model matches the recorded Rust source, that the named theorem corresponds to the public API, and that the reported precondition matches the theorem. A checked theorem alone does not establish those links or the adequacy of the specification. The current adapter records the default Cargo configuration, with ordinary Lean module paths and a pinned official Git dependency. Other backends, custom Lake source directories, and local-path Aeneas dependencies are unsupported. See https://proofs.rs/book/aeneas.html and https://github.com/AeneasVerif/aeneas/tree/be86ab0f1989d04944292b345b24c435be3ad10a.',
  '2026-10-16T00:00:00.000Z'
) ON CONFLICT DO NOTHING;
