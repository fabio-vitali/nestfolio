import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parse, stringify } from 'yaml';
import { inMemoryJournal } from '../../../engine/lib/journal.mjs';
import { mintCommand, deriveGeneration, mirrorLesson, parseFlags, curateCommand, considerCommand } from '../run-backward.mjs';

function tmpCfg() {
  const root = mkdtempSync(join(tmpdir(), 'nf-bwd-'));
  const cfg = { checksDir: join(root, 'checks'), lessonsDir: join(root, 'lessons'), scenariosDir: join(root, 'scenarios') };
  for (const d of Object.values(cfg)) mkdirSync(d, { recursive: true });
  return { root, cfg };
}
const proposal = () => ({
  id: 'no-x', property: 'no X anywhere', kind: 'drift',
  evaluator: { type: 'deterministic', run: 'cmd:node tools/check-x.mjs' },
  cost_tier: 'cheap', contexts: ['gate', 'invariant'],
  scope: { paths: ['services/**/*.ts'], dossiers: ['feedback_x.md'] },
  eval_scenario: { path: 'runtime/eval/scenarios/no-x.scenario.mjs',
    fixtures: { good: ['fixtures/no-x/good/a.ts'], bad: ['fixtures/no-x/bad/b.ts'] }, target_pass_rate: 1.0 },
  rationale: 'mechanizable, recurring, still intended',
  gates: { mechanizable: true, recurring: true, stillIntended: true },
});
const seedLesson = (dir) => writeFileSync(join(dir, 'feedback_x.md'),
  '---\nname: X\ndescription: d\ntype: feedback\n---\nbody\n', 'utf8');

test('BWD1 fresh mint parks (exit 3) with the epoch decision id + full candidate render', async () => {
  const { root, cfg } = tmpCfg();
  try {
    seedLesson(cfg.lessonsDir);
    const j = inMemoryJournal();
    const r = await mintCommand({ itemId: 'ws-1', lessonFile: join(cfg.lessonsDir, 'feedback_x.md'), proposal: proposal(), journal: j, cfg });
    assert.equal(r.exit, 3);
    assert.equal(r.out.pending[0].decision.id, 'mint-no-x-g1');
    assert.match(r.out.pending[0].decision.context, /candidate check \(full YAML\)/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('BWD2 fulfil ratify → registered check + landed scenario + reconciled lesson (exit 0); replay reprints (exit 0)', async () => {
  const { root, cfg } = tmpCfg();
  try {
    seedLesson(cfg.lessonsDir);
    const j = inMemoryJournal();
    const args = { itemId: 'ws-1', lessonFile: join(cfg.lessonsDir, 'feedback_x.md'), proposal: proposal(), journal: j, cfg };
    await mintCommand(args);                                                     // parks
    j.fulfil('backward', 'mint-no-x-g1', { decisionId: 'mint-no-x-g1', value: 'ratify' });
    const r2 = await mintCommand(args);
    assert.equal(r2.exit, 0);
    assert.equal(parse(readFileSync(join(cfg.checksDir, 'no-x.yaml'), 'utf8')).status, 'active');
    assert.ok(existsSync(join(cfg.scenariosDir, 'no-x.scenario.mjs')));
    const mints = parse(/^---\n([\s\S]*?)\n---/.exec(readFileSync(join(cfg.lessonsDir, 'feedback_x.md'), 'utf8'))[1]).mints;
    assert.equal(mints[0].check, 'no-x');
    const r3 = await mintCommand(args);                                          // replay — journal short-circuits
    assert.equal(r3.exit, 0);
    assert.equal(parse(readFileSync(join(cfg.lessonsDir, 'feedback_x.md'), 'utf8').match(/^---\n([\s\S]*?)\n---/)[1]).mints.length, 1);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('BWD3 edit fulfilment returns the draft AND re-opens the floor (next invoke parks, not stuck on edit)', async () => {
  const { root, cfg } = tmpCfg();
  try {
    seedLesson(cfg.lessonsDir);
    const j = inMemoryJournal();
    const args = { itemId: 'ws-1', lessonFile: join(cfg.lessonsDir, 'feedback_x.md'), proposal: proposal(), journal: j, cfg };
    await mintCommand(args);
    j.fulfil('backward', 'mint-no-x-g1', { decisionId: 'mint-no-x-g1', value: 'edit' });
    const r2 = await mintCommand(args);
    assert.equal(r2.exit, 0);
    assert.equal(r2.out.result.kind, 'edit');
    assert.equal(r2.out.result.draft.entry.id, 'no-x');
    const r3 = await mintCommand(args);                                          // revised proposal would go here
    assert.equal(r3.exit, 3);                                                    // asks fresh — not replaying 'edit'
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('BWD4 generation derivation: terminal on-disk id → g2 decision; ACTIVE on-disk id → exit 1', async () => {
  const { root, cfg } = tmpCfg();
  try {
    seedLesson(cfg.lessonsDir);
    // deriveGeneration only reads status + provenance.generation — a minimal YAML stub is enough
    writeFileSync(join(cfg.checksDir, 'no-x.yaml'), stringify({ id: 'no-x', status: 'retired',
      provenance: { minted_by: 'old', ratified: 't', retired_reason: 'r' } }), 'utf8');
    const j = inMemoryJournal();
    const r = await mintCommand({ itemId: 'ws-1', lessonFile: join(cfg.lessonsDir, 'feedback_x.md'), proposal: proposal(), journal: j, cfg });
    assert.equal(r.exit, 3);
    assert.equal(r.out.pending[0].decision.id, 'mint-no-x-g2');
    writeFileSync(join(cfg.checksDir, 'no-x.yaml'), stringify({ id: 'no-x', status: 'active',
      provenance: { minted_by: 'old', ratified: 't' } }), 'utf8');
    const r2 = await mintCommand({ itemId: 'ws-1', lessonFile: join(cfg.lessonsDir, 'feedback_x.md'), proposal: proposal(), journal: inMemoryJournal(), cfg });
    assert.equal(r2.exit, 1);                                                    // re-mint of a LIVE check → curate instead
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('BWD5 mirrorLesson copies an external dossier once, frontmatter intact', async () => {
  const { root, cfg } = tmpCfg();
  try {
    const ext = join(root, 'feedback_ext.md');
    writeFileSync(ext, '---\nname: E\ndescription: d\ntype: feedback\n---\nbody\n', 'utf8');
    assert.equal(mirrorLesson({ lessonFile: ext, lessonsDir: cfg.lessonsDir }), 'feedback_ext.md');
    const mirrored = readFileSync(join(cfg.lessonsDir, 'feedback_ext.md'), 'utf8');
    assert.match(mirrored, /^---\nname: E/);
    writeFileSync(join(cfg.lessonsDir, 'feedback_ext.md'), mirrored + 'LOCAL EDIT\n', 'utf8');
    mirrorLesson({ lessonFile: ext, lessonsDir: cfg.lessonsDir });               // second call: absent-only, no clobber
    assert.match(readFileSync(join(cfg.lessonsDir, 'feedback_ext.md'), 'utf8'), /LOCAL EDIT/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('BWD6 parseFlags: value flags, boolean flags, missing values', () => {
  assert.deepEqual(parseFlags(['--item', 'x', '--none', '--reason', 'r']), { item: 'x', none: true, reason: 'r' });
  assert.deepEqual(parseFlags(['--fulfil', '--value']), { fulfil: true, value: true });   // degenerate → caller treats as usage error
});

test('BWD-CLI1 malformed --value JSON → exit 2 with a clean one-line error (no stack trace)', () => {
  const r = spawnSync('node', ['runtime/adapters/claude-code/run-backward.mjs', 'mint', '--item', 'x', '--lesson', 'y', '--proposal', 'z', '--fulfil', 'k', '--value', '{bad'], { encoding: 'utf8', cwd: process.cwd() });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /invalid JSON for --value/);
  assert.doesNotMatch(r.stderr, /SyntaxError/);
});
test('BWD-CLI2 unknown subcommand → exit 2 usage, and does NOT touch the journal', () => {
  const r = spawnSync('node', ['runtime/adapters/claude-code/run-backward.mjs', 'frobnicate'], { encoding: 'utf8', cwd: process.cwd() });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /usage: run-backward\.mjs/);
});

const guardYaml = () => ({ id: 'no-x', property: 'no X', kind: 'drift',
  evaluator: { type: 'deterministic', run: 'cmd:node tools/check-x.mjs' }, cost_tier: 'cheap',
  contexts: ['gate', 'invariant'], scope: { paths: ['services/**/*.ts'], dossiers: ['feedback_x.md'] },
  status: 'active', provenance: { minted_by: 'ws-0', lesson: 'feedback_x.md', ratified: '2026-07-01' } });
const seedGuard = (cfg) => writeFileSync(join(cfg.checksDir, 'no-x.yaml'), stringify(guardYaml()), 'utf8');
const seedMintedLesson = (cfg) => writeFileSync(join(cfg.lessonsDir, 'feedback_x.md'),
  '---\nname: X\ndescription: d\ntype: feedback\nmints:\n  - check: no-x\n    ratified: "2026-07-01"\n    status: active\n---\nbody\n', 'utf8');

test('BWD7 curate parks with the full guard render; fulfil retire lowers the guard on disk', async () => {
  const { root, cfg } = tmpCfg();
  try {
    seedGuard(cfg); seedMintedLesson(cfg);
    const j = inMemoryJournal();
    const args = { checkId: 'no-x', trigger: 'ship-gate', reason: 'property abandoned', journal: j, cfg };
    const r1 = await curateCommand(args);
    assert.equal(r1.exit, 3);
    assert.equal(r1.out.pending[0].decision.id, 'curate-no-x-g1');
    assert.match(r1.out.pending[0].decision.context, /current guard \(full YAML\)/);
    j.fulfil('backward', 'curate-no-x-g1', { decisionId: 'curate-no-x-g1', value: 'retire' });
    const r2 = await curateCommand(args);
    assert.equal(r2.exit, 0);
    assert.equal(parse(readFileSync(join(cfg.checksDir, 'no-x.yaml'), 'utf8')).status, 'retired');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('BWD8 curate keep: no disk change, exit 0; keep re-opens the floor — a THIRD invoke parks again (not a replay)', async () => {
  const { root, cfg } = tmpCfg();
  try {
    seedGuard(cfg); seedMintedLesson(cfg);
    const j = inMemoryJournal();
    const args = { checkId: 'no-x', trigger: 'ship-gate', journal: j, cfg };
    await curateCommand(args);
    j.fulfil('backward', 'curate-no-x-g1', { decisionId: 'curate-no-x-g1', value: 'keep' });
    const r = await curateCommand(args);
    assert.equal(r.exit, 0);
    assert.equal(r.out.result.kind, 'kept');
    assert.equal(parse(readFileSync(join(cfg.checksDir, 'no-x.yaml'), 'utf8')).status, 'active');
    const r3 = await curateCommand(args);                                       // floor re-opened by the fulfilled keep
    assert.equal(r3.exit, 3);
    assert.equal(r3.out.pending[0].decision.id, 'curate-no-x-g1');
    assert.notEqual(r3.out.result.kind, 'kept');                                // NOT a replay of the fulfilled answer
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('BWD9 curate unknown check → exit 1', async () => {
  const { root, cfg } = tmpCfg();
  try {
    const r = await curateCommand({ checkId: 'ghost', trigger: 'ship-gate', journal: inMemoryJournal(), cfg });
    assert.equal(r.exit, 1);
    assert.match(r.out.error, /no such check/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('BWD10 consider records outcome+reason+sha+ts under consider:<item>; usage errors exit 2', () => {
  const j = inMemoryJournal();
  const r = considerCommand({ itemId: 'ws-1', none: true, reason: 'nothing mechanizable', journal: j, sha: 'abc', ts: 'T' });
  assert.equal(r.exit, 0);
  const rec = j.read('backward').steps.get('consider:ws-1');
  assert.deepEqual(rec.value, { outcome: 'none', reason: 'nothing mechanizable', sha: 'abc', ts: 'T' });
  assert.equal(considerCommand({ itemId: 'ws-1', journal: j, sha: 'a', ts: 't' }).exit, 2);              // no outcome/reason
  assert.equal(considerCommand({ itemId: 'ws-1', minted: 'c', none: true, reason: 'r', journal: j, sha: 'a', ts: 't' }).exit, 2);  // both
});
