import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse, stringify } from 'yaml';
import { inMemoryJournal } from '../../../engine/lib/journal.mjs';
import { mintCommand, deriveGeneration, mirrorLesson, parseFlags } from '../run-backward.mjs';

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
