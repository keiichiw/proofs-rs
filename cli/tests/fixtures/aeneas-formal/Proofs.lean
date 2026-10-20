import OtherProofs
open Aeneas Std
namespace Proofs
-- The reference model appears in the postcondition only.
def reference (x : U32) : U32 := x
theorem identity_spec (x : U32) (h : x.val < 100) :
    formal_fixture.identity x ⦃ y => y = reference x ⦄ := by
  simp [formal_fixture.identity, reference, WP.spec_ok]
theorem identity_zero :
    formal_fixture.identity 0#u32 ⦃ y => y = 0#u32 ⦄ := by
  simp [formal_fixture.identity, WP.spec_ok]
theorem manual (α : Type) [Inhabited α] (reference : α) : reference = reference := rfl
end Proofs
