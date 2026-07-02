// runtime/eval/grade-check-scenario.mjs — the CHECK-eval harness (§11/§15). Grades a landed check-eval
// scenario: deterministic ⇒ golden gate (good fixtures → 0 findings, bad → ≥1); the pass rate is the
// fraction of fixtures that behave as declared. runOverFixture is the injected project fixture-runner.
export async function gradeCheckScenario(scenario, { runOverFixture }) {
  const goodPass = [];
  for (const f of scenario.fixtures.good) goodPass.push((await runOverFixture(scenario.run, f)).length === 0);
  const badPass = [];
  for (const f of scenario.fixtures.bad) badPass.push((await runOverFixture(scenario.run, f)).length >= 1);
  const outcomes = [...goodPass, ...badPass];
  const passRate = outcomes.length ? outcomes.filter(Boolean).length / outcomes.length : 1;
  return { passRate, pass: passRate >= (scenario.target_pass_rate ?? 1), goodPass, badPass };
}
