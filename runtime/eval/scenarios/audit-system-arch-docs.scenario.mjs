// AUTO-LANDED by SPEC 2 landEvalScenario — guards audit-system-arch-docs. The SPEC-3 harness runs it:
// deterministic ⇒ golden gate (good → 0 findings, bad → ≥1 finding of kind inconsistency);
// judgment ⇒ calibrated (flake rate = 1 - gatePassRate must not exceed the flake budget).
export const scenario = {
  check: "audit-system-arch-docs",
  evaluator_kind: "judgment",
  run: "skill:audit-system",
  kind: "inconsistency",
  fixtures: {
  "good": [],
  "bad": []
},
  target_pass_rate: 0.95,
};
