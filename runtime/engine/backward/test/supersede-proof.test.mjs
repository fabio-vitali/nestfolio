import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { loadRegistry } from '../../lib/load-registry.mjs';
import { runCurate } from '../lib/curate.mjs';
import { inMemoryJournal } from '../lib/capabilities.mjs';
import { withTmpContent } from './_fixtures.mjs';

test('SUP1 sync-supersede no-ddb-scan → v2: chain both sides + mints re-aimed', () => {
  withTmpContent(({ checksDir, lessonsDir }) => {
    cpSync('runtime/content/checks/no-ddb-scan.yaml', join(checksDir, 'no-ddb-scan.yaml'));
    cpSync('runtime/content/lessons/feedback_no_scan_no_filter.md', join(lessonsDir, 'feedback_no_scan_no_filter.md'));
    const guard = loadRegistry({ checksDir }).byId.get('no-ddb-scan');
    const successor = { ...guard, id: 'no-ddb-scan-v2',
      property: 'No ScanCommand/.scan(/scanAll under services/**/src, and no FilterExpression on a GSI KEY attribute (__typename/tenantId/timestamp) — a reviewed FilterExpression on a NON-key attribute is allowed.',
      evaluator: { type: 'deterministic', run: 'cmd:node tools/check-no-ddb-scan.mjs' },
      provenance: { minted_by: 'narrow-ddb-filter-allowance', lesson: 'feedback_no_scan_no_filter.md', ratified: '2026-09-11' } };
    const finding = { id: 'f-sync', check: 'no-ddb-scan', kind: 'drift', scope: ['services/x/src/a.ts'], detail: 'reviewed non-key FilterExpression flagged', raised_at: '2026-09-11T00:00:00Z' };
    const r = runCurate({ guard, trigger: 'ship-gate-blocking', finding, proposedSuccessor: successor, rationale: 'property was too broad; narrow to GSI key attrs', ask: () => ({ selected: 'supersede' }), journal: inMemoryJournal(), checksDir, dossierRoot: lessonsDir });
    assert.equal(r.kind, 'superseded');
    assert.equal(parse(readFileSync(join(checksDir, 'no-ddb-scan.yaml'), 'utf8')).provenance.superseded_by, 'no-ddb-scan-v2');
    assert.equal(parse(readFileSync(join(checksDir, 'no-ddb-scan-v2.yaml'), 'utf8')).provenance.supersedes, 'no-ddb-scan');
    const mints = parse(/^---\n([\s\S]*?)\n---/.exec(readFileSync(join(lessonsDir, 'feedback_no_scan_no_filter.md'), 'utf8'))[1]).mints;
    assert.equal(mints.find((e) => e.check === 'no-ddb-scan').status, 'superseded');
    assert.equal(mints.find((e) => e.check === 'no-ddb-scan-v2').status, 'active');
  });
});
