-- proofs.rs adapter for Lean 4.35.0 / Aeneas be86ab0f.
-- Uses Lean's environment, Meta telescope and pretty-printer, never source parsing.
open Lean Meta Elab Command
namespace ProofsProbe
meta def moduleOf (env : Environment) (n : Name) : String :=
  match env.getModuleIdxFor? n with
  | some idx => env.header.moduleNames[idx.toNat]!.toString
  | none => ""
meta def pretty (e : Expr) : MetaM String := do
  let s := (← ppExpr e).pretty
  if s.contains '⋯' then
    throwError "Lean display contains an omission marker (or literal ⋯); refusing an incomplete proposition"
  if s.utf8ByteSize > 1000000 then throwError "Proposition exceeds 1,000,000-byte recording limit"
  return s
-- The full statement stays explicit; the inspection view uses Lean notation.
meta def readable (e : Expr) : MetaM String :=
  withOptions (fun o =>
    let o := o.setBool `pp.all false
    let o := o.setBool `pp.explicit false
    let o := o.setBool `pp.universes false
    o.setBool `pp.notation true) (pretty e)
-- Only a constant's own tag grants a link; names in plain text are never guessed.
partial def segments (code : Widget.CodeWithInfos) (ref : Option Name := none) : Array Json :=
  match code with
  | .text text => #[Json.mkObj (([("text", toJson text)]) ++
      (ref.toList.map fun n => ("ref", toJson n.toString)))]
  | .append parts => parts.foldl (fun acc part => acc ++ segments part ref) #[]
  | .tag info part =>
    let ref := match info.info.val.info with
      | .ofTermInfo ti => ti.expr.constName?
      | _ => none
    segments part ref
meta def readableFields (key : String) (e : Expr) : MetaM (List (String × Json)) := do
  let text ← readable e
  let base := [(key, toJson text)]
  try
    let code ← withOptions (fun o =>
      let o := o.setBool `pp.all false
      let o := o.setBool `pp.explicit false
      let o := o.setBool `pp.universes false
      let o := o.setBool `pp.notation true
      o.setBool `pp.tagAppFns true) (Widget.ppExprTagged e)
    let parts := segments code
    let joined := String.join (parts.toList.map fun j =>
      (j.getObjValAs? String "text").toOption.getD "")
    if joined != text || parts.size > 10000 || joined.utf8ByteSize > 1000000 then
      return base
    return base ++ [(key ++ "_segments", toJson parts)]
  catch _ => return base
meta def inspect (n : Name) (ty : Expr) (manual : Bool) : MetaM (Option Json) := do
  let env ← getEnv
  forallTelescope ty fun xs conclusion => do
    let programExpr ← try
      let normalized ← Aeneas.Utils.normalizeLetBindings conclusion
      let (expr, _) ← Aeneas.Step.getStepSpecFunArgsExpr normalized
      pure (some expr)
    catch _ => pure none
    if programExpr.isNone && !manual then return none
    let full ← pretty ty
    let program ← match programExpr with
      | some expr => pure (toJson (← readable expr))
      | none => pure Json.null
    let head := toJson (programExpr.bind (·.getAppFn.constName?) |>.map Name.toString)
    let mut binders := #[]
    for x in xs do
      let d ← x.fvarId!.getDecl
      let prop ← isProp d.type
      binders := binders.push (Json.mkObj ((← readableFields "type" d.type) ++ [
        ("name", toJson d.userName.toString),
        ("kind", toJson (if d.binderInfo.isInstImplicit then "instance" else if prop then "hypothesis" else "variable")),
        ("binder", toJson (if d.binderInfo.isInstImplicit then "instance" else if d.binderInfo.isExplicit then "explicit" else "implicit"))]))
    if binders.size > 1000 then throwError "More than 1000 binders"
    let some ranges ← findDeclarationRanges? n | throwError "Missing theorem source range: {n}"
    let axioms ← Lean.collectAxioms n
    let constants := ty.getUsedConstants
    let mut definitions := #[]
    for nm in constants.extract 0 100 do
      let ranges ← findDeclarationRanges? nm
      definitions := definitions.push (Json.mkObj [
        ("name", toJson nm.toString), ("module", toJson (moduleOf env nm)),
        ("source", match ranges with
          | some r => Json.mkObj [("first_line", toJson r.range.pos.line), ("last_line", toJson r.range.endPos.line)]
          | none => Json.null)])
    return some (Json.mkObj ((← readableFields "conclusion" conclusion) ++ [
      ("version", toJson (1 : Nat)), ("theorem", toJson n.toString),
      ("module", toJson (moduleOf env n)), ("statement", toJson full),
      ("binders", toJson binders),
      ("program", program), ("program_head", head),
      ("axioms", toJson (axioms.map Name.toString)),
      ("first_line", toJson ranges.range.pos.line), ("last_line", toJson ranges.range.endPos.line),
      ("definitions", toJson definitions), ("definitions_truncated", toJson (decide (constants.size > 100))),
      ("translation_rerun", toJson false)]))
end ProofsProbe
