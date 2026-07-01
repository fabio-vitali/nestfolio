// AUTO-LANDED by SPEC 2 landEvalScenario — guards no-ddb-scan. The SPEC-3 harness runs it:
// deterministic ⇒ golden gate (good → 0 findings, bad → ≥1 finding of kind drift);
// judgment ⇒ calibrated (flake rate = 1 - gatePassRate must not exceed the flake budget).
export const scenario = {
  check: "no-ddb-scan",
  evaluator_kind: "deterministic",
  run: "cmd:node tools/check-no-ddb-scan.mjs",
  kind: "drift",
  fixtures: {
  "good": [
    "runtime/eval/scenarios/fixtures/no-ddb-scan/good/gsi-query.ts"
  ],
  "bad": [
    "runtime/eval/scenarios/fixtures/no-ddb-scan/bad/scan-command.ts",
    "runtime/eval/scenarios/fixtures/no-ddb-scan/bad/filter-on-typename.ts"
  ]
},
  target_pass_rate: 1,
};
