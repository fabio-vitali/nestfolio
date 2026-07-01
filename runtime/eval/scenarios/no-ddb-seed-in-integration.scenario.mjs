// AUTO-LANDED by SPEC 2 landEvalScenario — guards no-ddb-seed-in-integration. The SPEC-3 harness runs it:
// deterministic ⇒ golden gate (good → 0 findings, bad → ≥1 finding of kind drift);
// judgment ⇒ calibrated (flake rate = 1 - gatePassRate must not exceed the flake budget).
export const scenario = {
  check: "no-ddb-seed-in-integration",
  evaluator_kind: "deterministic",
  run: "cmd:node tools/check-no-ddb-seed-in-integration.mjs",
  kind: "drift",
  fixtures: {
  "good": [
    "runtime/eval/scenarios/fixtures/no-ddb-seed-in-integration/good/via-events.ts"
  ],
  "bad": [
    "runtime/eval/scenarios/fixtures/no-ddb-seed-in-integration/bad/seed-fixture.ts",
    "runtime/eval/scenarios/fixtures/no-ddb-seed-in-integration/bad/direct-put.ts"
  ]
},
  target_pass_rate: 1,
};
