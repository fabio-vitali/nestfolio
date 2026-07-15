import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

import { Level2ApplicationService } from '../continuity/level-2/src/application-service.mjs';
import { canonicalJson, computeAggregateDigest, sha256, stableJson } from '../continuity/level-2/src/core.mjs';
import { validateComposedLock } from '../continuity/level-2/src/pack-validator.mjs';

const execFileAsync = promisify(execFile);
const REPO = process.cwd();
const LEVEL1_DIGEST = '376c1d5aff39a1477af1b49362f681d246b721b30c1e73b4f6ede247b0c9ffe4';

async function copyPath(sourceRoot, targetRoot, path) {
  await mkdir(dirname(join(targetRoot, path)), { recursive: true });
  await cp(join(sourceRoot, path), join(targetRoot, path), { recursive: true });
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'mi002-level2-'));
  for (const path of [
    'continuity/level-1',
    'continuity/level-2',
    '.claude/skills/backlog-next',
    '.claude/skills/continuity-repository-status',
    'package.json'
  ]) await copyPath(REPO, root, path);
  return root;
}

async function readLock(root) {
  return JSON.parse(await readFile(join(root, 'continuity/level-2/packs.lock.json'), 'utf8'));
}

async function writeLock(root, lock, { recompute = true } = {}) {
  if (recompute) lock.aggregate.digest = computeAggregateDigest(lock);
  await writeFile(join(root, 'continuity/level-2/packs.lock.json'), canonicalJson(lock));
}

async function setLevel1Active(root) {
  const path = join(root, 'continuity/level-2/activation.json');
  const activation = JSON.parse(await readFile(path, 'utf8'));
  activation.activeLevel = 1;
  activation.route = 'level-1';
  activation.activeLock = { path: 'continuity/level-1/pack-lock.json', aggregateDigest: LEVEL1_DIGEST };
  activation.revision += 1;
  await writeFile(path, canonicalJson(activation));
}

async function mutateFixture(t, mutate, options = {}) {
  const root = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const lock = await readLock(root);
  await mutate({ root, lock });
  if (options.writeLock !== false) await writeLock(root, lock, { recompute: options.recompute !== false });
  return { root, lock };
}

function resultSchema(result) {
  return {
    top: Object.keys(result).sort(),
    repository: Object.keys(result.repository).sort(),
    repositoryStatus: Object.keys(result.repositoryStatus).sort(),
    paths: Object.keys(result.repositoryStatus.paths).sort(),
    effects: Object.keys(result.effects).sort(),
    adapter: Object.keys(result.adapter).sort()
  };
}

test('C1/C2: selected Packs self-validate independently and the composed lock validates', async () => {
  const service = new Level2ApplicationService(REPO);
  const reusable = await service.selfValidate('continuity.repository-tools@1.0.0');
  const project = await service.selfValidate('nestfolio.level-1@1.0.1');
  const composed = await service.verify();
  assert.equal(reusable.status, 'pass');
  assert.equal(project.status, 'pass');
  assert.equal(composed.status, 'ready');
  assert.deepEqual(composed.validation.packs, ['continuity.repository-tools@1.0.0', 'nestfolio.level-1@1.0.1']);
  assert.equal(composed.validation.procedures.length, 2);
  assert.equal(composed.validation.verifiedFiles.some((item) => item.path === '.claude/skills/backlog-next/SKILL.md'), true);
});

test('C1: repeated exact resolution is byte-identical and ordered', async () => {
  const service = new Level2ApplicationService(REPO);
  const first = await service.resolve();
  const second = await service.resolve();
  assert.equal(first.status, 'ready');
  assert.equal(stableJson(first.resolution), stableJson(second.resolution));
  assert.equal(first.resolutionDigest, second.resolutionDigest);
  assert.deepEqual(first.resolution.map((item) => item.identity), ['continuity.repository-status@1.0.0', 'nestfolio.backlog-next@1.0.1']);
});

test('C3: reusable repository status is read-only in the bound repository', async () => {
  const service = new Level2ApplicationService(REPO);
  const before = await execFileAsync('git', ['status', '--porcelain=v2', '--untracked-files=all'], { cwd: REPO, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } });
  const result = await service.run('continuity.repository-status@1.0.0', REPO);
  const after = await execFileAsync('git', ['status', '--porcelain=v2', '--untracked-files=all'], { cwd: REPO, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } });
  assert.equal(result.status, 'ready');
  assert.equal(result.schema, 'continuity.repository-status.result@1');
  assert.deepEqual(result.effects, { repositoryWrites: [], networkRequests: [] });
  assert.equal(before.stdout, after.stdout);
});

test('C3: neutral Git fixture returns the same result schema without project configuration', async (t) => {
  const neutral = await mkdtemp(join(tmpdir(), 'mi002-neutral-git-'));
  t.after(() => rm(neutral, { recursive: true, force: true }));
  await execFileAsync('git', ['init', '-q'], { cwd: neutral });
  await writeFile(join(neutral, 'neutral.txt'), 'neutral\n');
  await execFileAsync('git', ['add', 'neutral.txt'], { cwd: neutral });
  await execFileAsync('git', ['-c', 'user.name=Continuity Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'neutral fixture'], { cwd: neutral });
  const service = new Level2ApplicationService(REPO);
  const project = await service.run('continuity.repository-status@1.0.0', REPO);
  const result = await service.run('continuity.repository-status@1.0.0', neutral);
  assert.equal(result.status, 'ready');
  assert.deepEqual(resultSchema(result), resultSchema(project));
  assert.equal(await realpath(result.repository.root), await realpath(neutral));
  assert.deepEqual(result.effects, { repositoryWrites: [], networkRequests: [] });
});

test('C5/C6: composed mapping preserves direct project behavior authority and exposes Level 2 guarantees', async () => {
  const service = new Level2ApplicationService(REPO);
  const project = await service.run('nestfolio.backlog-next@1.0.1', REPO);
  const compared = await service.compare();
  assert.equal(project.delegation.command, '/backlog-next');
  assert.equal(project.delegation.behaviorAuthority, '.claude/skills/backlog-next/SKILL.md');
  assert.equal(compared.comparison.retainedLevel1AssetCount, 19);
  assert.equal(compared.guarantees.adoption, 'Level 2 of 6');
  assert.equal(compared.guarantees.absent.level3.includes('Scope'), true);
  assert.equal(compared.guarantees.absent.level6.includes('completion transition'), true);
});

test('C6: every routine target package entry point routes through the Level 2 CLI', async () => {
  const packageJson = JSON.parse(await readFile(join(REPO, 'package.json'), 'utf8'));
  for (const name of ['continuity:pack:list', 'continuity:pack:install', 'continuity:pack:resolve', 'continuity:pack:verify', 'continuity:procedure:compare', 'continuity:procedure:run']) {
    assert.match(packageJson.scripts[name], /^node continuity\/level-2\/cli\.mjs /);
  }
});

test('C7: CAS activation succeeds from the exact predecessor and records history', async (t) => {
  const root = await fixture(); t.after(() => rm(root, { recursive: true, force: true }));
  await setLevel1Active(root);
  const service = new Level2ApplicationService(root, { now: () => new Date('2026-07-15T15:00:00.000Z') });
  const result = await service.install({ expectedPredecessor: LEVEL1_DIGEST, actor: 'mi-002-test' });
  assert.equal(result.status, 'ok');
  assert.equal(result.activation.activeLevel, 2);
  const history = await service.history();
  assert.equal(history.entries.at(-1).result, 'success');
  assert.equal(history.entries.at(-1).before, LEVEL1_DIGEST);
});

test('C7: isolated rollback restores exact Level 1 bytes and reapply selects the identical lock', async (t) => {
  const root = await fixture();
  const recovery = await mkdtemp(join(tmpdir(), 'mi002-recovery-'));
  const candidate = await mkdtemp(join(tmpdir(), 'mi002-reapply-'));
  t.after(() => Promise.all([root, recovery, candidate].map((path) => rm(path, { recursive: true, force: true }))));
  const lock = await readLock(root);
  await mkdir(join(recovery, 'continuity/level-1'), { recursive: true });
  const predecessorPackage = (await execFileAsync('git', ['show', 'HEAD:package.json'], { cwd: REPO, encoding: 'buffer' })).stdout;
  const predecessorActivation = (await execFileAsync('git', ['show', 'HEAD:continuity/level-1/activation.json'], { cwd: REPO, encoding: 'buffer' })).stdout;
  await writeFile(join(recovery, 'package.json'), predecessorPackage);
  await writeFile(join(recovery, 'continuity/level-1/activation.json'), predecessorActivation);
  await cp(join(REPO, 'package.json'), join(candidate, 'package.json'));
  const service = new Level2ApplicationService(root, { now: () => new Date('2026-07-15T15:01:00.000Z') });
  const rolledBack = await service.rollback({ expectedActive: lock.aggregate.digest, recoveryRoot: recovery, actor: 'mi-002-test' });
  assert.equal(rolledBack.status, 'ok');
  assert.deepEqual(await readFile(join(root, 'package.json')), predecessorPackage);
  assert.deepEqual(await readFile(join(root, 'continuity/level-1/activation.json')), predecessorActivation);
  const packageReapply = await service.reapplyPackage(candidate);
  assert.equal(packageReapply.status, 'ok');
  const reapplied = await service.install({ expectedPredecessor: LEVEL1_DIGEST, actor: 'mi-002-test' });
  assert.equal(reapplied.status, 'ok');
  assert.equal(reapplied.activation.activeLock.aggregateDigest, lock.aggregate.digest);
});

test('failure: duplicate Pack identity with divergent declaration blocks', async (t) => {
  const { root } = await mutateFixture(t, ({ lock }) => lock.packs.push({ ...structuredClone(lock.packs[0]), manifest: { ...lock.packs[0].manifest, sha256: '0'.repeat(64) } }));
  assert.equal((await new Level2ApplicationService(root).verify()).code, 'DUPLICATE_PACK_IDENTITY');
});

test('failure: duplicate Procedure identity with divergent spec blocks', async (t) => {
  const { root } = await mutateFixture(t, ({ lock }) => lock.packs[0].procedures.push({ ...structuredClone(lock.packs[0].procedures[0]), spec: { ...lock.packs[0].procedures[0].spec, sha256: '0'.repeat(64) } }));
  assert.equal((await new Level2ApplicationService(root).verify()).code, 'DUPLICATE_PROCEDURE_IDENTITY');
});

test('failure: competing Procedure entry point and asset path claims block', async (t) => {
  const first = await mutateFixture(t, ({ lock }) => { lock.packs[0].procedures[0].entryPoint = '/backlog-next'; });
  assert.equal((await new Level2ApplicationService(first.root).verify()).code, 'COMPETING_ENTRY_POINT');
  const second = await mutateFixture(t, ({ lock }) => { lock.packs[0].procedures[0].asset = structuredClone(lock.packs[1].procedures[0].asset); });
  assert.equal((await new Level2ApplicationService(second.root).verify()).code, 'MULTIPLE_ASSET_RESOLUTION');
});

test('failure: missing manifest, Procedure spec, executor asset, and declared prerequisite each block', async (t) => {
  for (const [path, code] of [
    ['continuity/level-2/packs/continuity.repository-tools/1.0.0/pack-manifest.json', 'MISSING_SOURCE'],
    ['continuity/level-2/packs/continuity.repository-tools/1.0.0/procedures/continuity.repository-status.json', 'MISSING_SOURCE'],
    ['.claude/skills/continuity-repository-status/SKILL.md', 'MISSING_SOURCE']
  ]) {
    const root = await fixture(); t.after(() => rm(root, { recursive: true, force: true }));
    await rm(join(root, path));
    assert.equal((await new Level2ApplicationService(root).verify()).code, code);
  }
  const { root, lock } = await mutateFixture(t, async ({ root, lock }) => {
    const path = lock.packs[0].procedures[0].spec.path;
    const spec = JSON.parse(await readFile(join(root, path), 'utf8'));
    spec.prerequisites = [];
    await writeFile(join(root, path), canonicalJson(spec));
    const bytes = await readFile(join(root, path));
    lock.packs[0].procedures[0].spec = { path, sha256: sha256(bytes), bytes: bytes.byteLength };
  });
  assert.equal((await new Level2ApplicationService(root).verify()).code, 'MISSING_DECLARED_PREREQUISITE');
});

test('failure: individual digest and byte-size drift block', async (t) => {
  const digest = await mutateFixture(t, async ({ root }) => writeFile(join(root, '.claude/skills/continuity-repository-status/SKILL.md'), '\ndrift\n', { flag: 'a' }));
  assert.equal((await new Level2ApplicationService(digest.root).verify()).code, 'SOURCE_DIGEST_MISMATCH');
  const size = await mutateFixture(t, ({ lock }) => { lock.packs[0].manifest.bytes += 1; });
  assert.equal((await new Level2ApplicationService(size.root).verify()).code, 'SOURCE_DIGEST_MISMATCH');
});

test('failure: aggregate lock digest tamper blocks', async (t) => {
  const { root } = await mutateFixture(t, ({ lock }) => { lock.aggregate.digest = '0'.repeat(64); }, { recompute: false });
  assert.equal((await new Level2ApplicationService(root).verify()).code, 'AGGREGATE_LOCK_DIGEST_MISMATCH');
});

test('failure: unenumerated reusable source blocks', async (t) => {
  const { root } = await mutateFixture(t, async ({ root }) => {
    await writeFile(join(root, 'continuity/level-2/packs/continuity.repository-tools/1.0.0/undeclared.txt'), 'undeclared\n');
  });
  assert.equal((await new Level2ApplicationService(root).verify()).code, 'UNENUMERATED_OR_MULTIPLY_SOURCED_ASSET');
});

test('failure: unsupported executor and adoption-level compatibility block', async (t) => {
  const executor = await mutateFixture(t, ({ lock }) => { lock.executorFamily = 'unsupported-executor'; });
  assert.equal((await new Level2ApplicationService(executor.root).verify()).code, 'UNSUPPORTED_EXECUTOR');
  const adoption = await mutateFixture(t, ({ lock }) => { lock.adoptionLevel = 3; });
  assert.equal((await new Level2ApplicationService(adoption.root).verify()).code, 'UNSUPPORTED_ADOPTION_LEVEL');
});

test('failure: missing required capability blocks', async (t) => {
  const root = await fixture(); t.after(() => rm(root, { recursive: true, force: true }));
  const lock = await readLock(root);
  await assert.rejects(() => validateComposedLock(root, lock, { availableCapabilities: ['local-process-execution'] }), (error) => error.code === 'MISSING_REQUIRED_CAPABILITY');
});

test('failure: undeclared or widened permission blocks', async (t) => {
  const { root } = await mutateFixture(t, ({ lock }) => { lock.packs[0].permissions.writes.push('repository-content'); });
  assert.equal((await new Level2ApplicationService(root).verify()).code, 'UNDECLARED_OR_WIDENED_PERMISSION');
});

test('failure: newly selected deprecated Pack blocks', async (t) => {
  const { root } = await mutateFixture(t, ({ lock }) => { lock.packs[0].compatibility.deprecated = true; });
  assert.equal((await new Level2ApplicationService(root).verify()).code, 'NEWLY_SELECTED_DEPRECATED_PACK');
});

test('failure: stale expected predecessor digest blocks activation', async (t) => {
  const root = await fixture(); t.after(() => rm(root, { recursive: true, force: true }));
  await setLevel1Active(root);
  const result = await new Level2ApplicationService(root).install({ expectedPredecessor: '0'.repeat(64), actor: 'mi-002-test' });
  assert.equal(result.code, 'STALE_PREDECESSOR_LOCK_DIGEST');
});

test('failure: interrupted replacement leaves the prior lock authoritative', async (t) => {
  const root = await fixture(); t.after(() => rm(root, { recursive: true, force: true }));
  await setLevel1Active(root);
  const path = join(root, 'continuity/level-2/activation.json');
  const before = await readFile(path);
  const service = new Level2ApplicationService(root, { now: () => new Date('2026-07-15T15:02:00.000Z') });
  const result = await service.install({ expectedPredecessor: LEVEL1_DIGEST, actor: 'mi-002-test', interruptBeforeRename: true });
  assert.equal(result.code, 'ATOMIC_REPLACEMENT_INTERRUPTED');
  assert.deepEqual(await readFile(path), before);
  const activation = JSON.parse(before);
  assert.equal(activation.activeLock.aggregateDigest, LEVEL1_DIGEST);
});

test('failure: reusable Pack reference to a prohibited project semantic blocks', async (t) => {
  const { root } = await mutateFixture(t, async ({ root, lock }) => {
    const declaration = lock.packs[0].procedures[0].asset;
    await writeFile(join(root, declaration.path), '\nProject marker: nestfolio\n', { flag: 'a' });
    const bytes = await readFile(join(root, declaration.path));
    declaration.sha256 = sha256(bytes);
    declaration.bytes = bytes.byteLength;
  });
  assert.equal((await new Level2ApplicationService(root).verify()).code, 'PROHIBITED_PROJECT_SEMANTIC');
});

test('failure: attempted higher-level, registry, and remote-source claims block', async () => {
  const service = new Level2ApplicationService(REPO);
  for (const claim of ['work', 'context-pack', 'run', 'assurance', 'learning', 'completion', 'registry', 'remote-source']) {
    const result = await service.verify({ claim });
    assert.equal(result.code, 'FORBIDDEN_HIGHER_LEVEL_CLAIM');
  }
});
