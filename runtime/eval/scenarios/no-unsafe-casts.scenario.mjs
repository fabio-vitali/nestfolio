// AUTO-LANDED by SPEC 2 landEvalScenario — guards no-unsafe-casts. The SPEC-3 harness runs it:
// deterministic ⇒ golden gate (good → 0 findings, bad → ≥1 finding of kind drift);
// judgment ⇒ calibrated (flake rate = 1 - gatePassRate must not exceed the flake budget).
export const scenario = {
  check: "no-unsafe-casts",
  evaluator_kind: "deterministic",
  run: "cmd:node tools/check-no-unsafe-casts.mjs",
  kind: "drift",
  fixtures: {
  "good": [
    "runtime/eval/scenarios/fixtures/no-unsafe-casts/good/aws-mock.ts"
  ],
  "bad": [
    "runtime/eval/scenarios/fixtures/no-unsafe-casts/bad/double-cast.ts",
    "runtime/eval/scenarios/fixtures/no-unsafe-casts/bad/eslint-disable.ts"
  ]
},
  target_pass_rate: 1,
};
