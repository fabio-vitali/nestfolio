// AUTO-LANDED by SPEC 2 landEvalScenario — guards no-agent-result-fallback. The SPEC-3 harness runs it:
// deterministic ⇒ golden gate (good → 0 findings, bad → ≥1 finding of kind drift);
// judgment ⇒ calibrated (flake rate = 1 - gatePassRate must not exceed the flake budget).
export const scenario = {
  check: "no-agent-result-fallback",
  evaluator_kind: "deterministic",
  run: "cmd:node tools/check-no-agent-result-fallback.mjs",
  kind: "drift",
  fixtures: {
  "good": [
    "runtime/eval/scenarios/fixtures/no-agent-result-fallback/good/throws.ts"
  ],
  "bad": [
    "runtime/eval/scenarios/fixtures/no-agent-result-fallback/bad/nullish-object.ts",
    "runtime/eval/scenarios/fixtures/no-agent-result-fallback/bad/nullish-array.ts"
  ]
},
  target_pass_rate: 1,
};
