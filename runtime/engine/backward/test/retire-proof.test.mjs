// runtime/engine/backward/test/retire-proof.test.mjs — the async arm end-to-end: SPEC 1 metaCheck
// files a dangling-scope staleness finding (code deleted), which runCurate retires at the floor (§5.2, §11.3).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { metaCheck } from '../../lib/meta-check.mjs';
import { runCurate } from '../lib/curate.mjs';
import { inMemoryJournal } from '../lib/capabilities.mjs';
import { withTmpContent, writeDossier, validCheck } from './_fixtures.mjs';

test('RET1 metaCheck files a dangling-scope staleness finding → runCurate retires it (state + mints)', () =>
  withTmpContent(async ({ checksDir, lessonsDir }) => {
    const guard = validCheck({ id: 'advisory-ctrl-guard', status: 'active',
      scope: { paths: ['services/advisory/advisory-ctrl/**/*.ts'] },
      provenance: { minted_by: 'g', lesson: 'feedback_x.md', ratified: '2026-05-01' } });
    writeDossier(lessonsDir, 'feedback_x', { name: 'X', description: 'd', type: 'feedback', mints: [{ check: 'advisory-ctrl-guard', ratified: '2026-05-01', status: 'active' }] });

    const findings = metaCheck({ registry: { checks: [guard] }, env: { resolveGlobs: () => [] } });
    const staleness = findings.find((f) => f.kind === 'staleness');
    assert.ok(staleness, 'metaCheck should file a staleness finding');
    assert.match(staleness.detail, /retirement-candidate/);

    const r = await runCurate({ guard, trigger: 'dangling-scope', finding: staleness, rationale: 'advisory-ctrl removed (33→32 services)', ask: async (d) => ({ decisionId: d.id, value: 'retire' }), journal: inMemoryJournal(), checksDir, dossierRoot: lessonsDir });
    assert.equal(r.kind, 'retired');
    assert.equal(r.check.status, 'retired');
    assert.equal(parse(/^---\n([\s\S]*?)\n---/.exec(readFileSync(join(lessonsDir, 'feedback_x.md'), 'utf8'))[1]).mints[0].status, 'retired');
  }));

test('RET2 async retire never gates an unrelated ship (finding is non-blocking)', () => {
  const guard = validCheck({ id: 'g', status: 'active', scope: { paths: ['services/gone/**/*.ts'] } });
  const findings = metaCheck({ registry: { checks: [guard] }, env: { resolveGlobs: () => [] } });
  assert.equal(guard.status, 'active');   // unchanged — the meta-check never advances state
  assert.equal(findings.filter((f) => f.kind === 'staleness').length, 1);
});
