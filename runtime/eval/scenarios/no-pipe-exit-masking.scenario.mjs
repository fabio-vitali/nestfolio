// AUTO-LANDED by SPEC 2 landEvalScenario — guards no-pipe-exit-masking. The SPEC-3 harness runs it:
// deterministic ⇒ golden gate (good → 0 findings, bad → ≥1 finding of kind drift);
// judgment ⇒ calibrated (flake rate = 1 - gatePassRate must not exceed the flake budget).
export const scenario = {
  check: "no-pipe-exit-masking",
  evaluator_kind: "deterministic",
  run: "cmd:node tools/check-pipe-mask.mjs",
  kind: "drift",
  fixtures: {
  "good": [
    "runtime/eval/scenarios/fixtures/no-pipe-exit-masking/good/with-pipefail.sh"
  ],
  "bad": [
    "runtime/eval/scenarios/fixtures/no-pipe-exit-masking/bad/tee-no-pipefail.sh"
  ]
},
  target_pass_rate: 1,
};
