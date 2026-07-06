// grade-check-scenario.real.test.mjs — the DATA-DRIVEN golden gate. Where grade-check-scenario.test.mjs
// exercises the grader with a FAKE runOverFixture, this drives gradeCheckScenario over the REAL
// *.scenario.mjs files with a REAL runOverFixture that actually runs each check over its fixtures:
//   - module:<path>#<fn>  → import the core fn, run it over the fixture DIRECTORY
//   - cmd:node tools/…mjs → import the check's findViolations, run it over each fixture FILE with an
//                           in-scope synthetic path (the fixtures live under runtime/eval/, not the
//                           check's scan root, so the path shape must be supplied here — the one thing
//                           the check's own file walker can't infer).
// A new deterministic scenario gets golden-gate coverage in CI by adding one CMD_SCAN_PATH line (cmd:)
// or nothing at all (module:). Runs under the `runtime` test target (globs runtime/eval/test/*.test.mjs),
// which is picked up by tools/affected-projects.mjs → pr-deploy.yml / deploy.yml.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gradeCheckScenario } from '../grade-check-scenario.mjs';

const ROOT = process.cwd(); // the runtime test target runs from the workspace root (house convention)
const SCEN_DIR = join(ROOT, 'runtime/eval/scenarios');

// Per-check in-scope synthetic path for cmd: evaluators. A cmd check's findViolations(text, relPath)
// guards on the repo-relative path shape (…/src/, …/test/integration/, scripts/…); the fixtures sit
// under runtime/eval/scenarios/fixtures/, which no check would scan — so the golden gate feeds a
// representative in-scope path, exactly like each tools/check-*.test.mjs does. Keyed by scenario.check.
const CMD_SCAN_PATH = {
  'no-ddb-scan': (b) => `services/x/src/${b}`,
  'no-unsafe-casts': (b) => `libs/x/src/${b}`,
  'no-states-runtime-catch': (b) => `services/x/src/${b}`,
  'no-agent-result-fallback': (b) => `services/advisory/x/src/${b}`,
  'no-ddb-seed-in-integration': (b) => `services/x/x-ctrl/test/integration/${b}`,
  'no-pipe-exit-masking': (b) => `scripts/${b}`,
};

/** Resolve a scenario `run` spec to an executable predicate over a fixture path. */
async function resolveRunner(scenario) {
  const { run, check } = scenario;
  if (run.startsWith('module:')) {
    const [rel, fn] = run.slice('module:'.length).split('#');
    const mod = await import(pathToFileURL(join(ROOT, rel)).href);
    assert.equal(typeof mod[fn], 'function', `${check}: module run "${run}" has no exported ${fn}()`);
    // module: fixtures are directories; the core fn takes a dir and returns violations.
    return (fixtureRel) => mod[fn](join(ROOT, fixtureRel));
  }
  if (run.startsWith('cmd:')) {
    const m = run.match(/^cmd:node\s+(\S+\.mjs)\b/);
    assert.ok(m, `${check}: unrecognized cmd run spec "${run}"`);
    const mod = await import(pathToFileURL(join(ROOT, m[1])).href);
    assert.equal(typeof mod.findViolations, 'function', `${check}: ${m[1]} exports no findViolations()`);
    const scanPath = CMD_SCAN_PATH[check];
    assert.ok(scanPath, `${check}: cmd check has no CMD_SCAN_PATH entry — add one so the fixture is in-scope`);
    // cmd: fixtures are single files; feed the text with an in-scope synthetic path.
    return (fixtureRel) => mod.findViolations(readFileSync(join(ROOT, fixtureRel), 'utf8'), scanPath(basename(fixtureRel)));
  }
  throw new Error(`${check}: unrecognized run spec "${run}"`);
}

// Discover the landed scenarios up front (top-level await), then register one test per deterministic one.
const loaded = readdirSync(SCEN_DIR)
  .filter((f) => f.endsWith('.scenario.mjs'))
  .map((f) => ({ file: f, scenario: null }));
for (const entry of loaded) entry.scenario = (await import(pathToFileURL(join(SCEN_DIR, entry.file)).href)).scenario;

const deterministic = loaded.filter(
  ({ scenario }) => scenario?.evaluator_kind === 'deterministic' && Array.isArray(scenario?.fixtures?.good) && Array.isArray(scenario?.fixtures?.bad),
);

test('discovers the landed deterministic check-eval scenarios (guard against silent zero-discovery)', () => {
  assert.ok(deterministic.length >= 8, `expected >= 8 deterministic scenarios, found ${deterministic.length} of ${loaded.length} scenario files`);
});

for (const { scenario } of deterministic) {
  const kind = scenario.run.split(':', 1)[0];
  test(`${scenario.check} (${kind}:) — good fixtures→0, bad fixtures→≥1 via the real grader`, async () => {
    const runner = await resolveRunner(scenario);
    const runOverFixture = async (_run, fixtureRel) => runner(fixtureRel);
    const r = await gradeCheckScenario(scenario, { runOverFixture });
    assert.equal(
      r.pass,
      true,
      `${scenario.check}: passRate=${r.passRate} good=${JSON.stringify(r.goodPass)} bad=${JSON.stringify(r.badPass)}`,
    );
    assert.equal(r.passRate, 1, scenario.check);
  });
}
