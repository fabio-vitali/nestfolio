// AUTO-LANDED by SPEC 2 landEvalScenario — guards no-states-runtime-catch. The SPEC-3 harness runs it:
// deterministic ⇒ golden gate (good → 0 findings, bad → ≥1 finding of kind drift);
// judgment ⇒ calibrated (flake rate = 1 - gatePassRate must not exceed the flake budget).
export const scenario = {
  check: "no-states-runtime-catch",
  evaluator_kind: "deterministic",
  run: "cmd:node tools/check-no-states-runtime-catch.mjs",
  kind: "drift",
  fixtures: {
  "good": [
    "runtime/eval/scenarios/fixtures/no-states-runtime-catch/good/choice-tolerance.ts"
  ],
  "bad": [
    "runtime/eval/scenarios/fixtures/no-states-runtime-catch/bad/catch-states-runtime.ts"
  ]
},
  target_pass_rate: 1,
};
