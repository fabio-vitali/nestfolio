// runtime/engine/backward/test/dogfood.test.mjs — the moat's proof-of-life: all five real lessons
// run draft → floor-ratify → register → eval, hermetically in a tmpdir (§10, §11.1).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { runMint } from '../lib/mint.mjs';
import { inMemoryJournal } from '../lib/capabilities.mjs';
import { validateCheck } from '../../schema/check.schema.ts';
import { DOGFOOD } from '../dogfood/lessons.mjs';
import { withTmpContent } from './_fixtures.mjs';

for (const { item, lesson, proposal } of DOGFOOD) {
  test(`DOGFOOD ${proposal.id}: ratify → active yaml + landed scenario + reconciled mints`, () => {
    withTmpContent(({ checksDir, lessonsDir, scenariosDir }) => {
      cpSync(join('runtime/content/lessons', lesson), join(lessonsDir, lesson));   // real in-repo mirror
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
      cpSync(join('runtime/content/lessons', lesson), join(lessonsDir, lesson));
      const r = runMint({ item, lesson, proposal, journal: inMemoryJournal(), checksDir, dossierRoot: lessonsDir, scenariosDir });   // headless
      assert.equal(r.kind, 'paused');
      assert.equal(existsSync(join(checksDir, `${proposal.id}.yaml`)), false);
    });
  }
});
