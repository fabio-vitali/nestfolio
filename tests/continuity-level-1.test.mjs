import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, readdir, rm, unlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { Level1ApplicationService } from '../continuity/level-1/src/application-service.mjs';

const REPO = process.cwd();

async function walk(root) {
  const out = [];
  async function visit(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) await visit(full);
      else out.push(relative(root, full).split('\\').join('/'));
    }
  }
  await visit(root);
  return out.sort();
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'mi001-level1-'));
  for (const path of ['continuity/level-1', '.claude/skills/backlog-next']) {
    await cp(join(REPO, path), join(root, path), { recursive: true });
  }
  for (const path of ['CLAUDE.md', 'package.json']) {
    await cp(join(REPO, path), join(root, path));
  }
  await cp(join(REPO, 'docs/BACKLOG.md'), join(root, 'docs/BACKLOG.md'), { recursive: true });
  return root;
}

async function mutateJson(root, path, fn) {
  const full = join(root, path);
  const value = JSON.parse(await readFile(full, 'utf8'));
  fn(value);
  await writeFile(full, `${JSON.stringify(value, null, 2)}\n`);
}

test('C1/C2/C4/C6: inspect exposes one Level 1 Procedure and a complete exact lock', async () => {
  const service = new Level1ApplicationService(REPO);
  const result = await service.inspect();
  assert.equal(result.status, 'ready');
  assert.equal(result.guarantees.adoption, 'Level 1 of 6');
  assert.equal(result.pack.id, 'nestfolio.level-1');
  assert.equal(result.pack.version, '1.0.1');
  assert.equal(result.procedure.identity.id, 'nestfolio.backlog-next');
  assert.equal(result.procedure.identity.version, '1.0.1');
  assert.equal(result.binding.procedure.entryPoint, '/backlog-next');
  assert.equal(result.guarantees.absent.level6.includes('completion authority'), true);
  const actual = (await walk(join(REPO, '.claude/skills/backlog-next')))
    .map((path) => `.claude/skills/backlog-next/${path}`);
  assert.deepEqual(result.lock.assets.map((asset) => asset.path).sort(), actual);
  assert.equal(result.lock.assets.every((asset) => /^[a-f0-9]{64}$/.test(asset.sha256)), true);
});

test('C1/C6: invoke returns bounded Claude Code delegation and non-canonical provenance', async () => {
  const service = new Level1ApplicationService(REPO);
  const result = await service.invoke(['--auto']);
  assert.equal(result.status, 'ready');
  assert.equal(result.delegation.command, '/backlog-next --auto');
  assert.equal(result.delegation.behaviorAuthority.path, '.claude/skills/backlog-next/SKILL.md');
  assert.equal(result.provenance.persistedAsCanonicalState, false);
  assert.match(result.provenance.invocationDigest, /^[a-f0-9]{64}$/);
});

test('missing primary Skill asset fails closed', async (t) => {
  const root = await fixture(); t.after(() => rm(root, { recursive: true, force: true }));
  await unlink(join(root, '.claude/skills/backlog-next/SKILL.md'));
  const result = await new Level1ApplicationService(root).invoke([]);
  assert.equal(result.status, 'blocked');
  assert.match(result.code, /MISSING_PREREQUISITE|ASSET_MISSING/);
});

test('locked asset digest mismatch fails before delegation', async (t) => {
  const root = await fixture(); t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, '.claude/skills/backlog-next/LESSONS.md'), '\nDRIFT\n', { flag: 'a' });
  const result = await new Level1ApplicationService(root).invoke([]);
  assert.equal(result.status, 'blocked');
  assert.equal(result.code, 'ASSET_DIGEST_MISMATCH');
});

test('missing declared prerequisite fails with remediation', async (t) => {
  const root = await fixture(); t.after(() => rm(root, { recursive: true, force: true }));
  await unlink(join(root, 'docs/BACKLOG.md'));
  const result = await new Level1ApplicationService(root).invoke([]);
  assert.equal(result.status, 'blocked');
  assert.equal(result.code, 'REPOSITORY_IDENTITY_MISMATCH');
  assert.ok(result.remediation);
});

test('duplicate Procedure id/version fails activation preflight', async (t) => {
  const root = await fixture(); t.after(() => rm(root, { recursive: true, force: true }));
  await mutateJson(root, 'continuity/level-1/pack-manifest.json', (manifest) => {
    manifest.procedures.push({ ...manifest.procedures[0] });
  });
  const result = await new Level1ApplicationService(root).preflight();
  assert.equal(result.status, 'blocked');
  assert.equal(result.code, 'DUPLICATE_PROCEDURE_IDENTITY');
});

test('duplicate asset source fails activation preflight', async (t) => {
  const root = await fixture(); t.after(() => rm(root, { recursive: true, force: true }));
  await mutateJson(root, 'continuity/level-1/pack-lock.json', (lock) => {
    lock.assets.push({ ...lock.assets[0] });
  });
  const result = await new Level1ApplicationService(root).preflight();
  assert.equal(result.status, 'blocked');
  assert.equal(result.code, 'DUPLICATE_ASSET_SOURCE');
});

test('mixed 1.0.0 and 1.0.1 identity fails closed', async (t) => {
  const root = await fixture(); t.after(() => rm(root, { recursive: true, force: true }));
  await mutateJson(root, 'continuity/level-1/activation.json', (activation) => {
    activation.procedure = 'nestfolio.backlog-next@1.0.0';
  });
  const result = await new Level1ApplicationService(root).preflight();
  assert.equal(result.status, 'blocked');
  assert.equal(result.code, 'IDENTITY_MISMATCH');
});

test('locked byte-size mismatch fails closed even with a coherent aggregate digest', async (t) => {
  const root = await fixture(); t.after(() => rm(root, { recursive: true, force: true }));
  await mutateJson(root, 'continuity/level-1/pack-lock.json', (lock) => {
    lock.assets[0].bytes += 1;
  });
  const lock = JSON.parse(await readFile(join(root, 'continuity/level-1/pack-lock.json'), 'utf8'));
  const { createHash } = await import('node:crypto');
  const { stableJson } = await import('../continuity/level-1/src/core.mjs');
  lock.lockDigest = createHash('sha256').update(stableJson({
    pack: lock.pack, procedure: lock.procedure, algorithm: lock.algorithm, assets: lock.assets
  })).digest('hex');
  await writeFile(join(root, 'continuity/level-1/pack-lock.json'), `${JSON.stringify(lock, null, 2)}\n`);
  const result = await new Level1ApplicationService(root).preflight();
  assert.equal(result.status, 'blocked');
  assert.equal(result.code, 'ASSET_DIGEST_MISMATCH');
});


test('an unenumerated file under the Skill root fails closed', async (t) => {
  const root = await fixture(); t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, '.claude/skills/backlog-next/unlocked.txt'), 'not locked');
  const result = await new Level1ApplicationService(root).preflight();
  assert.equal(result.status, 'blocked');
  assert.equal(result.code, 'UNLOCKED_ASSET');
});

test('tampered aggregate lock digest fails closed', async (t) => {
  const root = await fixture(); t.after(() => rm(root, { recursive: true, force: true }));
  await mutateJson(root, 'continuity/level-1/pack-lock.json', (lock) => {
    lock.lockDigest = '0'.repeat(64);
  });
  const result = await new Level1ApplicationService(root).preflight();
  assert.equal(result.status, 'blocked');
  assert.equal(result.code, 'LOCK_DIGEST_MISMATCH');
});

test('representative Level 2-6 authority and completion claims are rejected', async () => {
  for (const claim of ['work', 'context-pack', 'run', 'completion', 'lesson']) {
    const result = await new Level1ApplicationService(REPO).preflight({ claim });
    assert.equal(result.status, 'blocked');
    assert.equal(result.code, 'FORBIDDEN_HIGHER_LEVEL_CLAIM');
  }
});

test('corrupt lock fails closed', async (t) => {
  const root = await fixture(); t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'continuity/level-1/pack-lock.json'), '{broken');
  const result = await new Level1ApplicationService(root).preflight();
  assert.equal(result.status, 'blocked');
  assert.equal(result.code, 'CORRUPT_OR_MISSING_CONFIGURATION');
});

test('C3/C7: disable leaves direct current Skill discoverable and target removable', async (t) => {
  const root = await fixture(); t.after(() => rm(root, { recursive: true, force: true }));
  const service = new Level1ApplicationService(root);
  const disabled = await service.setActivation(false);
  assert.equal(disabled.status, 'ok');
  const blocked = await service.invoke([]);
  assert.equal(blocked.code, 'LEVEL1_DISABLED');
  const skill = await readFile(join(root, '.claude/skills/backlog-next/SKILL.md'), 'utf8');
  assert.match(skill, /name: backlog-next/);
  assert.match(skill, /When activation is `false` or the target boundary has been removed, continue directly/);
  await rm(join(root, 'continuity/level-1'), { recursive: true, force: true });
  assert.equal(existsSync(join(root, '.claude/skills/backlog-next/SKILL.md')), true);
  assert.equal(existsSync(join(root, 'docs/BACKLOG.md')), true);
});

test('the e2e-feature-tests test target declares the NODE_OPTIONS convention', async () => {
  const project = JSON.parse(
    await readFile(join(REPO, 'apps', 'e2e-feature-tests', 'project.json'), 'utf8'),
  );
  const target = project.targets['test-e2e-features'];
  assert.equal(target.options.env?.NODE_OPTIONS, '--experimental-vm-modules');
});

test('the integration prefix is read as PREFIX in every code and configuration file', async () => {
  // The six paths are read BY PATH, so this assertion never scans its own
  // source, and the old name is assembled from fragments for the same reason: a
  // literal here would itself be an occurrence, and the assertion would then be
  // asserting something about this file.
  //
  // Six, not the four the tracker issue enumerates. The two GitHub workflows
  // SET the variable rather than reading it, which is exactly why a list written
  // from the issue's prose would leave CI setting a name nothing reads.
  const OLD = ['NESTFOLIO', 'INTEG', 'PREFIX'].join('_');
  const paths = [
    'libs/test-support/src/context.ts',
    'libs/test-support/test/context.test.ts',
    'apps/nestfolio-e2e/playwright.config.ts',
    'apps/e2e-feature-tests/jest.global-teardown.ts',
    '.github/workflows/nestfolio-e2e.yml',
    '.github/workflows/pr-deploy.yml',
  ];
  for (const path of paths) {
    const content = await readFile(join(REPO, path), 'utf8');
    assert.equal(content.includes(OLD), false, `${path} still names ${OLD}`);
    assert.match(content, /\bPREFIX\b/, `${path} does not name PREFIX`);
  }
});

test('the dead ExecutionAdptEventTypes block is gone from broker-sim-adpt', async () => {
  // Read BY PATH, so this assertion never scans its own source, and the symbol
  // is assembled from fragments for the same reason: a literal here would be an
  // occurrence, and the assertion would then be asserting something about this
  // file.
  //
  // Two paths, not the one the tracker issue's backlog note names. The domain
  // barrel re-exports the symbol, so removing the block alone would not compile.
  const DEAD = ['Execution', 'Adpt', 'EventTypes'].join('');
  for (const path of [
    'services/execution/broker-sim-adpt/src/domain/events.ts',
    'services/execution/broker-sim-adpt/src/domain/index.ts',
  ]) {
    const content = await readFile(join(REPO, path), 'utf8');
    assert.equal(content.includes(DEAD), false, `${path} still names ${DEAD}`);
  }
  // And the live sibling stayed: this is a deletion of dead code, not of the
  // block beside it that the service actually emits.
  const events = await readFile(
    join(REPO, 'services/execution/broker-sim-adpt/src/domain/events.ts'),
    'utf8',
  );
  assert.match(events, /BrokerSimEventTypes/);
});
