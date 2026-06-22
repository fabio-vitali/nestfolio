import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isSurfaceFile, scanSurfaces } from '../detect-fork-blast-radius.mjs';

test('isSurfaceFile matches the curated shared/exported surfaces only', () => {
  assert.equal(isSurfaceFile('libs/event-types/src/names.ts'), true);
  assert.equal(isSurfaceFile('libs/ui/src/index.ts'), true);          // shared-lib export
  assert.equal(isSurfaceFile('flows/advisory-cycle.flow.yaml'), true);
  assert.equal(isSurfaceFile('libs/cdk-constructs/src/core/egress.ts'), true);
  // NON-surfaces:
  assert.equal(isSurfaceFile('libs/ui/src/lib/button.ts'), false);    // not the index barrel
  assert.equal(isSurfaceFile('services/investor-ctrl/src/handler.ts'), false);
  assert.equal(isSurfaceFile('apps/investor-web/src/main.ts'), false);
});

test('scanSurfaces finds a literal symbol across given entries, with location', () => {
  const entries = [
    { path: 'libs/event-types/src/names.ts', content: 'export const MANDATE_ISSUED = "MandateIssued";\nother' },
    { path: 'services/x/src/h.ts', content: 'no match here' },
  ];
  const hits = scanSurfaces(['MANDATE_ISSUED'], entries);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].path, 'libs/event-types/src/names.ts');
  assert.equal(hits[0].line, 1);
  assert.equal(hits[0].pattern, 'MANDATE_ISSUED');
});

test('scanSurfaces returns [] when no pattern matches or patterns are empty', () => {
  const entries = [{ path: 'libs/event-types/src/names.ts', content: 'nothing relevant' }];
  assert.deepEqual(scanSurfaces(['ZZZ_NOPE'], entries), []);
  assert.deepEqual(scanSurfaces([], entries), []);
});
