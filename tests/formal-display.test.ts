import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createViews } from "../src/site-views";
import { formalSourceLinks, validLeanSegments } from "../web/formal-evidence";

const formal = () => ({
  theorem: "Demo.spec",
  statement: "∀ s : Demo.State, ↑s.value = 1",
  binders: [
    {
      name: "s",
      kind: "variable",
      type: "Demo.State",
      type_segments: [{ text: "Demo.State", ref: "Demo.State" }],
    },
    { name: "h", kind: "hypothesis", type: "s = s" },
    { name: "inst", kind: "instance", type: "Inhabited Demo.State" },
  ],
  conclusion: "↑s.value < 10 ∧ s = s",
  conclusion_segments: [
    { text: "↑s.value < 10 ∧ " },
    { text: "s", ref: "unresolved" },
    { text: " = s" },
  ],
  source: { file: "Proofs.lean", first_line: 3, last_line: 9 },
  definitions: [
    {
      name: "Demo.State",
      module: "Demo",
      source: {
        file: "generated/Demo State.lean",
        first_line: 1,
        last_line: 4,
      },
    },
  ],
  mapping: "manual",
  check_url: "/runs/run",
});
function render(f: any) {
  return new JSDOM(
    createViews({ user: null }, {}, () => "").claimContent({
      claim_number: 1,
      title: "Example",
      signature: "fn example()",
      precondition: "true",
      formal_evidence: f,
    }),
  ).window.document;
}
test("readable Lean preserves binder order, inline types, exact statement and revision links", () => {
  const f = formalSourceLinks(
    formal(),
    "https://github.com/demo/repo",
    "a".repeat(40),
  );
  const d = render(f);
  assert.deepEqual(
    [...d.querySelectorAll(".lean-role")].map((x) => x.textContent),
    ["for all", "assume", "instance", "then"],
  );
  assert.equal(d.querySelector(".lean-readable pre"), null);
  assert.equal(
    d.querySelector(".lean-expression")!.textContent,
    "s : Demo.State",
  );
  assert.equal(
    d.querySelector(".lean-expression a")!.getAttribute("href"),
    `https://github.com/demo/repo/blob/${"a".repeat(40)}/generated/Demo%20State.lean#L1-L4`,
  );
  assert.equal(d.querySelector(".lean-conclusion a"), null);
  assert.equal(
    d.querySelector("[data-copy-formal]")!.parentElement!.querySelector("code")!
      .textContent,
    f.statement,
  );
  assert.match(d.body.textContent!, /implicit type conversion/);
  assert.match(d.body.textContent!, /Preconditionstrue/);
});
test("legacy and inconsistent tagged data fall back to escaped text without inferred links", () => {
  const f: any = formalSourceLinks(
    formal(),
    "https://github.com/demo/repo",
    "a".repeat(40),
  );
  delete f.binders[0].type_segments;
  f.conclusion = "<img src=x onerror=alert(1)>";
  const d = render(f);
  assert.equal(d.querySelector(".lean-readable a"), null);
  assert.equal(d.querySelector(".lean-readable img"), null);
  assert.equal(
    d.querySelector(".lean-conclusion .lean-expression")!.textContent,
    f.conclusion,
  );
  assert.equal(validLeanSegments("x", [{ text: "y" }]), false);
  assert.equal(validLeanSegments("x", [{ text: "x", ref: "" }]), false);
  assert.equal(
    validLeanSegments(
      "",
      Array.from({ length: 10001 }, () => ({ text: "" })),
    ),
    false,
  );
});
