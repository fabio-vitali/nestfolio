import { appendFileSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
const id = process.argv[2];
// failCycles: CLI arg wins, else env BEF_WORKER_FAIL_CYCLES (so a scenario can drive it via
// worker.{failCycles} without baking it into the prompt narrative).
const argCycles = process.argv.find((a) => a.startsWith('--fail-cycles='));
const failCycles = Number(argCycles ? argCycles.split('=')[1] : (process.env.BEF_WORKER_FAIL_CYCLES ?? 0));
// fork: CLI arg (--fork=<symbol>) wins, else env BEF_WORKER_FORK. When set, the member surfaces an
// in-member architectural fork on <symbol> on its FIRST cycle instead of shipping — the orchestrator
// must decide it (run its blast-radius gate over <symbol>). The worker exits 0 WITHOUT shipping; if the
// orchestrator auto-resolves and re-drives the member, the 2nd cycle ships normally.
const argFork = process.argv.find((a) => a.startsWith('--fork='));
const fork = argFork ? argFork.split('=')[1] : (process.env.BEF_WORKER_FORK ?? '');
appendFileSync('stubs.log', `backlog-next-worker ${id}\n`);
const statePath = '.worker-state.json';
const state = existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : {};
state[id] = (state[id] ?? 0) + 1;
writeFileSync(statePath, JSON.stringify(state));
if (state[id] <= failCycles) { console.error(`member ${id} integration FAILED (cycle ${state[id]})`); process.exit(1); }
if (fork && state[id] === 1) { console.log(`<<MEMBER-FORK: symbol=${fork}>>`); process.exit(0); }
const f = join(process.cwd(), `${id}.md`);
writeFileSync(f, readFileSync(f, 'utf8').replace(/status: active/, 'status: shipped'));
console.log(`shipped ${id}`);
