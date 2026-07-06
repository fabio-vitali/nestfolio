// runtime/engine/backward/dogfood/lessons.mjs — the §10 five-lesson dogfood table AS DATA (seam #2,
// NOT ring-1). Reused by the proof test and the materializer. Each proposal is the worker's reduction
// of one real mechanizable feedback_* lesson to a single deterministic property. Δ1 run grammar throughout.
import { fileURLToPath } from 'node:url';

const gatesAllPass = { mechanizable: true, recurring: true, stillIntended: true };
const fx = (id, good, bad) => ({ path: `runtime/eval/scenarios/${id}.scenario.mjs`,
  fixtures: { good: good.map((f) => `runtime/eval/scenarios/fixtures/${id}/good/${f}`), bad: bad.map((f) => `runtime/eval/scenarios/fixtures/${id}/bad/${f}`) }, target_pass_rate: 1.0 });

export const DOGFOOD = [
  { item: { id: 'no-ddb-scan-guard' }, lesson: 'feedback_no_scan_no_filter.md', proposal: {
      id: 'no-ddb-scan', property: 'No ScanCommand/.scan(/scanAll under services/**/src, and no FilterExpression on a GSI key attribute (__typename/tenantId/timestamp).',
      kind: 'drift', evaluator: { type: 'deterministic', run: 'cmd:node tools/check-no-ddb-scan.mjs' }, cost_tier: 'cheap',
      contexts: ['invariant', 'gate'], scope: { paths: ['services/**/src/**/*.ts'], dossiers: ['feedback_no_scan_no_filter.md'] },
      eval_scenario: fx('no-ddb-scan', ['gsi-query.ts'], ['scan-command.ts', 'filter-on-typename.ts']),
      rationale: 'mechanizable forbidden-token set; guards recurring table-scan cost blowups; still intended.', gates: gatesAllPass } },
  { item: { id: 'no-agent-result-fallback-guard' }, lesson: 'feedback_no_silent_fallback_in_agent_results.md', proposal: {
      id: 'no-agent-result-fallback', property: 'No ?? {} / ?? [] fallback on an AgentCore/orchestrator invocation result in advisory agent services.',
      kind: 'drift', evaluator: { type: 'deterministic', run: 'cmd:node tools/check-no-agent-result-fallback.mjs' }, cost_tier: 'cheap',
      contexts: ['invariant', 'gate'], scope: { paths: ['services/advisory/**/src/**/*.ts'], dossiers: ['feedback_no_silent_fallback_in_agent_results.md'], exclusions: 'runtime/content/exclusions/agent-result-fallback-exclusions.json' },
      eval_scenario: fx('no-agent-result-fallback', ['throws.ts'], ['nullish-object.ts', 'nullish-array.ts']),
      rationale: 'a missing agent-result key means the agent did not run; silent ?? hides a degraded 200. Mechanizable, recurring, still intended.', gates: gatesAllPass } },
  { item: { id: 'no-ddb-seed-guard' }, lesson: 'feedback_no_seeder_fixtures.md', proposal: {
      id: 'no-ddb-seed-in-integration', property: 'No DdbSeedFixture/AccountSeedingFixture/direct DDB write under services/**/test/integration/**.',
      kind: 'drift', evaluator: { type: 'deterministic', run: 'cmd:node tools/check-no-ddb-seed-in-integration.mjs' }, cost_tier: 'cheap',
      contexts: ['invariant', 'gate'], scope: { paths: ['services/**/test/integration/**/*.ts'], dossiers: ['feedback_no_seeder_fixtures.md'], exclusions: 'runtime/content/exclusions/ddb-seed-exclusions.json' },
      eval_scenario: fx('no-ddb-seed-in-integration', ['via-events.ts'], ['seed-fixture.ts', 'direct-put.ts']),
      rationale: 'integration fixtures must seed via the app pipeline; direct DDB writes bypass CDC. Mechanizable, recurring, still intended.', gates: gatesAllPass } },
  { item: { id: 'no-unsafe-casts-guard' }, lesson: 'feedback_prefer_libraries_over_casts.md', proposal: {
      id: 'no-unsafe-casts', property: 'No unsafe double-cast, as-any, or eslint-disable in production source (services/libs/apps **/src, excluding test/**).',
      kind: 'drift', evaluator: { type: 'deterministic', run: 'cmd:node tools/check-no-unsafe-casts.mjs' }, cost_tier: 'cheap',
      contexts: ['invariant'], scope: { paths: ['services/**/src/**/*.ts', 'libs/**/src/**/*.ts', 'apps/**/src/**/*.ts'], dossiers: ['feedback_prefer_libraries_over_casts.md'] },
      eval_scenario: fx('no-unsafe-casts', ['aws-mock.ts'], ['double-cast.ts', 'eslint-disable.ts']),
      rationale: 'prefer ecosystem libs over casts; mechanizable token set; recurring; still intended.', gates: gatesAllPass } },
  { item: { id: 'no-states-runtime-catch-guard' }, lesson: 'feedback_states_runtime_uncatchable.md', proposal: {
      id: 'no-states-runtime-catch', property: 'No Step Functions Catch/Retry whose ErrorEquals includes States.Runtime.',
      kind: 'drift', evaluator: { type: 'deterministic', run: 'cmd:node tools/check-no-states-runtime-catch.mjs' }, cost_tier: 'cheap',
      contexts: ['invariant', 'gate'], scope: { paths: ['services/**/src/**/*.ts'], dossiers: ['feedback_states_runtime_uncatchable.md'] },
      eval_scenario: fx('no-states-runtime-catch', ['choice-tolerance.ts'], ['catch-states-runtime.ts']),
      rationale: 'States.Runtime is uncatchable; a Catch on it silently never fires. Mechanizable, recurring, still intended.', gates: gatesAllPass } },
];

function main() { console.log(`${DOGFOOD.length} dogfood lessons`); }
if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) main();
