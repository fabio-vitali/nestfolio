import { appendFileSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
const id = process.argv[2];
const failCycles = Number((process.argv.find((a) => a.startsWith('--fail-cycles=')) ?? '=0').split('=')[1]);
appendFileSync('stubs.log', `backlog-next-worker ${id}\n`);
const statePath = '.worker-state.json';
const state = existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : {};
state[id] = (state[id] ?? 0) + 1;
writeFileSync(statePath, JSON.stringify(state));
if (state[id] <= failCycles) { console.error(`member ${id} integration FAILED (cycle ${state[id]})`); process.exit(1); }
const f = join(process.cwd(), `${id}.md`);
writeFileSync(f, readFileSync(f, 'utf8').replace(/status: active/, 'status: shipped'));
console.log(`shipped ${id}`);
