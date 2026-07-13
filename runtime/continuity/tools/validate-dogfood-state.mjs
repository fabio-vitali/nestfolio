#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, token, index, all) => {
  if (token.startsWith('--')) pairs.push([token.slice(2), all[index + 1]]);
  return pairs;
}, []));
const runId = args['run-id'];
if (!runId) throw new Error('--run-id is required');
const root = process.cwd();
const read = (kind, id) => JSON.parse(readFileSync(join(root, 'continuity', 'artifacts', kind, `${id}.json`), 'utf8'));
const run = read('runs', runId);
const head = JSON.parse(readFileSync(join(root, '.continuity', 'runs', runId, 'head.json'), 'utf8'));
const effects = JSON.parse(readFileSync(join(root, '.continuity', 'runs', runId, 'effects.json'), 'utf8'));
const sessions = run.session_refs.map((ref) => read('sessions', ref.id));
const checkpoints = run.checkpoint_refs.map((ref) => read('checkpoints', ref.id));
const handoffs = (run.handoff_refs ?? []).map((ref) => read('handoffs', ref.id));

const assertions = [
  [sessions.length >= 2, 'expected at least two Sessions'],
  [sessions.some((session) => session.status === 'interrupted'), 'expected an interrupted first Session'],
  [sessions.some((session) => session.resumed_from_checkpoint_ref), 'expected a fresh resumed Session'],
  [checkpoints.some((checkpoint) => checkpoint.status === 'verified'), 'expected a verified Checkpoint'],
  [handoffs.some((handoff) => handoff.status === 'published' && handoff.transcript_dependency === false), 'expected transcript-independent published Handoff'],
  [effects.effects.filter((effect) => effect.key === 'vs001-material-effect' && effect.status === 'completed').length === 1, 'expected exactly one completed keyed effect'],
  [head.last_resume_validation?.passed === true, 'expected passing stale/Pack/lease resume validation'],
];
const failures = assertions.filter(([passed]) => !passed).map(([, message]) => message);
if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log(JSON.stringify({
  run_id: runId,
  sessions: sessions.map((session) => ({ id: session.id, status: session.status })),
  checkpoints: checkpoints.map((checkpoint) => ({ id: checkpoint.id, status: checkpoint.status })),
  handoffs: handoffs.map((handoff) => ({ id: handoff.id, status: handoff.status })),
  effect_keys: effects.effects.map((effect) => effect.key),
  resume_validation: head.last_resume_validation,
}, null, 2));
