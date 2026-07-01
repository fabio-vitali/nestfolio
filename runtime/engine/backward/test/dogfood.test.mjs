// runtime/engine/backward/test/dogfood.test.mjs — the moat's proof-of-life: all five real lessons
// run draft → floor-ratify → register → eval, hermetically in a tmpdir (§10, §11.1).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse, stringify } from 'yaml';
import { runMint } from '../lib/mint.mjs';
import { inMemoryJournal } from '../lib/capabilities.mjs';
import { validateCheck } from '../../schema/check.schema.ts';
import { DOGFOOD } from '../dogfood/lessons.mjs';
import { withTmpContent } from './_fixtures.mjs';

const FM = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/;
// Seed the tmpdir with the lesson in its PRE-MINT state (mints stripped) — a fresh mint is what this
// proves, and it must not depend on whether E3's materialize already recorded this check in the mirror.
function seedFresh(lessonsDir, lesson) {
  const m = FM.exec(readFileSync(join('runtime/content/lessons', lesson), 'utf8'));
  const front = parse(m[1]); delete front.mints;
  writeFileSync(join(lessonsDir, lesson), `---\n${stringify(front)}---\n${m[2]}`, 'utf8');
}

for (const { item, lesson, proposal } of DOGFOOD) {
  test(`DOGFOOD ${proposal.id}: ratify → active yaml + landed scenario + reconciled mints`, () => {
    withTmpContent(({ checksDir, lessonsDir, scenariosDir }) => {
      seedFresh(lessonsDir, lesson);   // real in-repo mirror, pre-mint state
      const r = runMint({ item, lesson, proposal, ask: () => ({ selected: 'ratify' }), journal: inMemoryJournal(), checksDir, dossierRoot: lessonsDir, scenariosDir });
      assert.equal(r.kind, 'minted', `${proposal.id} should mint`);
      const persisted = parse(readFileSync(join(checksDir, `${proposal.id}.yaml`), 'utf8'));
      assert.equal(validateCheck(persisted).ok, true, `${proposal.id} yaml invalid`);
      assert.equal(persisted.status, 'active');
      assert.equal(persisted.provenance.minted_by, item.id);
      assert.equal(persisted.provenance.lesson, lesson);
      assert.ok(persisted.provenance.ratified);
      assert.match(persisted.evaluator.run, /^cmd:node tools\/check-/);   // Δ1
      assert.ok(existsSync(join(scenariosDir, `${proposal.id}.scenario.mjs`)));
      const mints = parse(/^---\n([\s\S]*?)\n---/.exec(readFileSync(join(lessonsDir, lesson), 'utf8'))[1]).mints;
      assert.deepEqual(mints, [{ check: proposal.id, ratified: persisted.provenance.ratified, status: 'active' }]);
    });
  });
}

test('DOGFOOD --auto pauses every lesson (never self-ratifies)', () => {
  for (const { item, lesson, proposal } of DOGFOOD) {
    withTmpContent(({ checksDir, lessonsDir, scenariosDir }) => {
      seedFresh(lessonsDir, lesson);
      const r = runMint({ item, lesson, proposal, journal: inMemoryJournal(), checksDir, dossierRoot: lessonsDir, scenariosDir });   // headless
      assert.equal(r.kind, 'paused');
      assert.equal(existsSync(join(checksDir, `${proposal.id}.yaml`)), false);
    });
  }
});
