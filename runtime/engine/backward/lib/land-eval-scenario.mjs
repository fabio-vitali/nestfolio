// land-eval-scenario.mjs — landEvalScenario(): §9 handoff. Writes the scenario module (good/bad
// fixtures) so the learning loop is itself regression-protected, and returns the EvalScenarioLanding
// the SPEC-3 harness consumes. Idempotent: keyed by check id (a replay does not double-write).
import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export function landEvalScenario({ draft, scenariosDir }) {
  const { entry, eval_scenario } = draft;
  const kind = entry.evaluator.type;
  const scenarioPath = join(scenariosDir, `${entry.id}.scenario.mjs`);
  mkdirSync(dirname(scenarioPath), { recursive: true });
  if (!existsSync(scenarioPath)) writeFileSync(scenarioPath, renderScenarioModule(entry, eval_scenario), 'utf8');

  const landing = {
    check: entry.id,
    evaluator_kind: kind,
    scenario_path: scenarioPath,
    fixtures: eval_scenario.fixtures,
    registered_via: 'harness:landScenario',
  };
  if (kind === 'judgment') landing.flake_contract = entry.flake_contract;
  return landing;
}

function renderScenarioModule(entry, ev) {
  return `// AUTO-LANDED by SPEC 2 landEvalScenario — guards ${entry.id}. The SPEC-3 harness runs it:
// deterministic ⇒ golden gate (good → 0 findings, bad → ≥1 finding of kind ${entry.kind});
// judgment ⇒ calibrated (flake rate = 1 - gatePassRate must not exceed the flake budget).
export const scenario = {
  check: ${JSON.stringify(entry.id)},
  evaluator_kind: ${JSON.stringify(entry.evaluator.type)},
  run: ${JSON.stringify(entry.evaluator.run)},
  kind: ${JSON.stringify(entry.kind)},
  fixtures: ${JSON.stringify(ev.fixtures, null, 2)},
  target_pass_rate: ${ev.target_pass_rate},
};
`;
}

function main() { console.error('land-eval-scenario.mjs is a library; import landEvalScenario'); process.exit(2); }
if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) main();
