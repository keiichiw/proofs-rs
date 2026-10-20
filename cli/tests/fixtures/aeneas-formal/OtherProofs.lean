import FormalFixture
open Aeneas Std
namespace Proofs
theorem other_zero : formal_fixture.other 0#u32 ⦃ y => y = 0#u32 ⦄ := by
  simp [formal_fixture.other, WP.spec_ok]
theorem ordinary_helper : True := by trivial
end Proofs
