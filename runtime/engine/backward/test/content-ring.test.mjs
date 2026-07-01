// runtime/engine/backward/test/content-ring.test.mjs — F1 reconciliation: the COMMITTED content ring
// is coherent — it equals the dogfood table, its mints:↔check pointers close both ways (enforcement-as-
// memory), it loads clean, and SPEC 1 metaCheck is green over the enlarged real registry.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { loadRegistry } from '../../lib/load-registry.mjs';
import { metaCheck } from '../../lib/meta-check.mjs';
import { DOGFOOD } from '../dogfood/lessons.mjs';

const CHECKS = 'runtime/content/checks';
const LESSONS = 'runtime/content/lessons';
const mintsOf = (lesson) => parse(/^---\n([\s\S]*?)\n---/.exec(readFileSync(join(LESSONS, lesson), 'utf8'))[1]).mints ?? [];

test('CR1 committed content ring = the 5 dogfood checks, all active, Δ1 cmd scheme', () => {
  const reg = loadRegistry({ checksDir: CHECKS });
  assert.equal(reg.errors.length, 0, JSON.stringify(reg.errors));
  for (const { proposal } of DOGFOOD) {
    const c = reg.byId.get(proposal.id);
    assert.ok(c, `${proposal.id} missing from ring`);
    assert.equal(c.status, 'active');
    assert.match(c.evaluator.run, /^cmd:node tools\/check-/);
    assert.ok(c.provenance.ratified, `${proposal.id} not ratified`);
  }
});

test('CR2 mints:↔check pointers close BOTH ways (enforcement-as-memory)', () => {
  const reg = loadRegistry({ checksDir: CHECKS });
  for (const { lesson, proposal } of DOGFOOD) {
    const entry = mintsOf(lesson).find((e) => e.check === proposal.id);
    assert.ok(entry, `${lesson} has no mints entry for ${proposal.id}`);
    assert.equal(entry.status, 'active');
    // reverse: the check's provenance.lesson points back at this lesson
    assert.equal(reg.byId.get(proposal.id).provenance.lesson, lesson);
  }
});

test('CR3 metaCheck is green over the enlarged real registry (no staleness when scopes resolve)', () => {
  const reg = loadRegistry({ checksDir: CHECKS });
  const findings = metaCheck({ registry: reg, env: { resolveGlobs: (paths) => paths } });   // every scope resolves
  const staleForMinted = findings.filter((f) => f.kind === 'staleness' && DOGFOOD.some((d) => d.proposal.id === f.check));
  assert.deepEqual(staleForMinted, [], `unexpected staleness: ${JSON.stringify(staleForMinted)}`);
});
