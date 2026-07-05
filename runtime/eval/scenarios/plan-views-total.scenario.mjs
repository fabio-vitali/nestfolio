// AUTO-LANDED by SPEC 2 landEvalScenario — guards plan-views-total. The SPEC-3 harness runs it:
// deterministic ⇒ golden gate (good → 0 findings, bad → ≥1 finding of kind drift);
// judgment ⇒ calibrated (flake rate = 1 - gatePassRate must not exceed the flake budget).
export const scenario = {
  check: "plan-views-total",
  evaluator_kind: "deterministic",
  run: "module:runtime/content/lib/plan-views-core.mjs#planViewsViolations",
  kind: "drift",
  fixtures: {
  "good": [
    "runtime/eval/scenarios/fixtures/plan-views-total/good"
  ],
  "bad": [
    "runtime/eval/scenarios/fixtures/plan-views-total/bad"
  ]
},
  target_pass_rate: 1,
};
