// AUTO-LANDED by SPEC 2 landEvalScenario — guards item-store-valid. The SPEC-3 harness runs it:
// deterministic ⇒ golden gate (good → 0 findings, bad → ≥1 finding of kind inconsistency);
// judgment ⇒ calibrated (flake rate = 1 - gatePassRate must not exceed the flake budget).
export const scenario = {
  check: "item-store-valid",
  evaluator_kind: "deterministic",
  run: "module:runtime/content/lib/item-store-core.mjs#itemStoreViolations",
  kind: "inconsistency",
  fixtures: {
  "good": [
    "runtime/eval/scenarios/fixtures/item-store-valid/good"
  ],
  "bad": [
    "runtime/eval/scenarios/fixtures/item-store-valid/bad"
  ]
},
  target_pass_rate: 1,
};
