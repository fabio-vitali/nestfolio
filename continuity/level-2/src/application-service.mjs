import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import {
  ContinuityLevel2Error,
  assertNoForbiddenClaim,
  failure,
  guaranteeCard,
  sha256,
  stableJson
} from './core.mjs';
import { observeRepositoryStatus } from './git-repository-adapter.mjs';
import { selfValidatePack, validateComposedLock } from './pack-validator.mjs';
import {
  LEVEL2_PATHS,
  appendHistory,
  hashFile,
  readHistory,
  readJson,
  resolveWithin,
  writeBytesAtomic,
  writeJsonAtomic
} from './repository-infrastructure.mjs';

function exactIdentity(value) {
  return typeof value === 'string' && /^[a-z0-9][a-z0-9.-]+@\d+\.\d+\.\d+$/.test(value);
}

export class Level2ApplicationService {
  constructor(workspaceRoot, options = {}) {
    this.workspaceRoot = resolve(workspaceRoot);
    this.now = options.now ?? (() => new Date());
  }

  async load() {
    const [activation, lock] = await Promise.all([
      readJson(this.workspaceRoot, LEVEL2_PATHS.activation),
      readJson(this.workspaceRoot, LEVEL2_PATHS.lock)
    ]);
    return { activation, lock };
  }

  async verify(options = {}) {
    try {
      assertNoForbiddenClaim(options.claim);
      const { activation, lock } = await this.load();
      const validation = await validateComposedLock(this.workspaceRoot, lock, options);
      if (options.requireActive !== false) {
        if (activation.activeLevel !== 2 || activation.route !== 'level-2' || activation.activeLock?.aggregateDigest !== validation.aggregateDigest) {
          throw new ContinuityLevel2Error('LEVEL2_NOT_ACTIVE', 'The composed Level 2 lock is valid but not the active target authority.', { activation, expectedAggregateDigest: validation.aggregateDigest });
        }
      }
      return { status: 'ready', activation, lock, validation, guarantees: guaranteeCard() };
    } catch (error) {
      return failure(error);
    }
  }

  async list() {
    const result = await this.verify();
    if (result.status !== 'ready') return result;
    return {
      status: 'ready',
      activeLock: result.validation.aggregateDigest,
      packs: result.validation.packs,
      guarantees: result.guarantees
    };
  }

  async resolve(identity = undefined) {
    const result = await this.verify();
    if (result.status !== 'ready') return result;
    if (identity && !exactIdentity(identity)) {
      return failure(new ContinuityLevel2Error('EXACT_VERSION_REQUIRED', 'Procedure resolution requires an exact id@major.minor.patch identity.', { identity }));
    }
    const selected = result.validation.procedures
      .filter((procedure) => !identity || procedure.identity === identity)
      .map((procedure) => ({
        identity: procedure.identity,
        pack: procedure.pack,
        class: procedure.class,
        entryPoint: procedure.entryPoint,
        spec: procedure.spec,
        asset: procedure.asset,
        capabilities: [...procedure.requiredCapabilities],
        permissions: procedure.permissions
      }));
    if (identity && selected.length === 0) return failure(new ContinuityLevel2Error('PROCEDURE_NOT_FOUND', `Procedure ${identity} is not selected by the active composed lock.`));
    return {
      status: 'ready',
      activeLock: result.validation.aggregateDigest,
      resolution: selected,
      resolutionDigest: sha256(stableJson(selected)),
      guarantees: result.guarantees
    };
  }

  async compare() {
    const result = await this.verify();
    if (result.status !== 'ready') return result;
    const prior = result.lock.previousLock;
    return {
      status: 'ready',
      comparison: {
        predecessor: {
          adoption: 'Level 1 of 6',
          identity: prior.identity,
          aggregateDigest: prior.aggregateDigest,
          procedures: ['nestfolio.backlog-next@1.0.1']
        },
        active: {
          adoption: 'Level 2 of 6',
          aggregateDigest: result.validation.aggregateDigest,
          packs: result.validation.packs,
          procedures: result.validation.procedures.map((procedure) => ({
            identity: procedure.identity,
            asset: procedure.asset.path,
            permissions: procedure.permissions
          }))
        },
        retainedLevel1AssetCount: 19,
        overrides: 0,
        registries: 0,
        remoteSources: 0
      },
      guarantees: result.guarantees
    };
  }

  async selfValidate(identity) {
    try {
      const { lock } = await this.load();
      return await selfValidatePack(this.workspaceRoot, lock, identity);
    } catch (error) {
      return failure(error);
    }
  }

  async run(identity, repositoryWorkingDirectory) {
    const resolved = await this.resolve(identity);
    if (resolved.status !== 'ready') return resolved;
    if (identity !== 'continuity.repository-status@1.0.0') {
      return {
        status: 'ready',
        procedure: resolved.resolution[0],
        delegation: {
          adapter: 'claude-code',
          action: 'invoke-repository-skill',
          command: resolved.resolution[0].entryPoint,
          behaviorAuthority: resolved.resolution[0].asset.path
        },
        guarantees: resolved.guarantees
      };
    }
    try {
      const observed = await observeRepositoryStatus(repositoryWorkingDirectory);
      return {
        status: 'ready',
        schema: 'continuity.repository-status.result@1',
        pack: 'continuity.repository-tools@1.0.0',
        procedure: 'continuity.repository-status@1.0.0',
        adapter: {
          family: 'claude-code',
          entryPoint: '/continuity-repository-status',
          asset: resolved.resolution[0].asset.path,
          activeLock: resolved.activeLock
        },
        ...observed,
        effects: { repositoryWrites: [], networkRequests: [] },
        guarantees: resolved.guarantees
      };
    } catch (error) {
      return failure(error);
    }
  }

  async install({ expectedPredecessor, actor = 'unknown', command = 'pack-install', interruptBeforeRename = false } = {}) {
    try {
      const { activation, lock } = await this.load();
      const validation = await validateComposedLock(this.workspaceRoot, lock);
      if (!expectedPredecessor || activation.activeLock?.aggregateDigest !== expectedPredecessor) {
        throw new ContinuityLevel2Error('STALE_PREDECESSOR_LOCK_DIGEST', 'The expected predecessor lock digest does not match the active authority.', { expected: expectedPredecessor, actual: activation.activeLock?.aggregateDigest });
      }
      const timestamp = this.now().toISOString();
      const next = {
        ...activation,
        activeLevel: 2,
        route: 'level-2',
        activeLock: { path: LEVEL2_PATHS.lock, aggregateDigest: validation.aggregateDigest },
        revision: (activation.revision ?? 0) + 1,
        activatedAt: timestamp
      };
      try {
        await writeJsonAtomic(this.workspaceRoot, LEVEL2_PATHS.activation, next, { interruptBeforeRename });
      } catch (error) {
        await appendHistory(this.workspaceRoot, {
          actor, after: validation.aggregateDigest, before: expectedPredecessor,
          command, result: 'failed', code: error.code ?? 'ATOMIC_REPLACEMENT_FAILED', utc: timestamp
        });
        throw error;
      }
      await appendHistory(this.workspaceRoot, {
        actor, after: validation.aggregateDigest, before: expectedPredecessor,
        command, result: 'success', utc: timestamp
      });
      return { status: 'ok', activation: next, guarantees: guaranteeCard() };
    } catch (error) {
      return failure(error);
    }
  }

  async rollback({ expectedActive, recoveryRoot, actor = 'unknown', command = 'rollback' } = {}) {
    try {
      const { activation, lock } = await this.load();
      if (activation.activeLock?.aggregateDigest !== expectedActive || activation.activeLevel !== 2) {
        throw new ContinuityLevel2Error('STALE_PREDECESSOR_LOCK_DIGEST', 'Rollback expected-active digest does not match the active Level 2 authority.', { expected: expectedActive, actual: activation.activeLock?.aggregateDigest });
      }
      const packageBytes = await readFile(resolveWithin(recoveryRoot, 'package.json'));
      const level1ActivationBytes = await readFile(resolveWithin(recoveryRoot, 'continuity/level-1/activation.json'));
      const packageIdentity = { sha256: sha256(packageBytes), bytes: packageBytes.byteLength };
      const activationIdentity = { sha256: sha256(level1ActivationBytes), bytes: level1ActivationBytes.byteLength };
      if (stableJson(packageIdentity) !== stableJson(lock.previousLock.packageJson) || stableJson(activationIdentity) !== stableJson(lock.previousLock.activation)) {
        throw new ContinuityLevel2Error('ROLLBACK_RECOVERY_IDENTITY_MISMATCH', 'The external recovery copy is not the exact retained Level 1 rollback target.', { expected: lock.previousLock, packageIdentity, activationIdentity });
      }
      await writeBytesAtomic(this.workspaceRoot, 'package.json', packageBytes);
      await writeBytesAtomic(this.workspaceRoot, 'continuity/level-1/activation.json', level1ActivationBytes);
      const timestamp = this.now().toISOString();
      const next = {
        ...activation,
        activeLevel: 1,
        route: 'level-1',
        activeLock: { path: lock.previousLock.path, aggregateDigest: lock.previousLock.aggregateDigest },
        revision: (activation.revision ?? 0) + 1,
        activatedAt: timestamp
      };
      await writeJsonAtomic(this.workspaceRoot, LEVEL2_PATHS.activation, next);
      await appendHistory(this.workspaceRoot, { actor, after: lock.previousLock.aggregateDigest, before: expectedActive, command, result: 'success', utc: timestamp });
      return { status: 'ok', activation: next, guarantees: guaranteeCard() };
    } catch (error) {
      return failure(error);
    }
  }

  async reapplyPackage(candidateRoot) {
    try {
      const { lock } = await this.load();
      const bytes = await readFile(resolveWithin(candidateRoot, 'package.json'));
      const identity = { sha256: sha256(bytes), bytes: bytes.byteLength };
      if (stableJson(identity) !== stableJson(lock.activationRoute.packageJson)) {
        throw new ContinuityLevel2Error('REAPPLY_CANDIDATE_IDENTITY_MISMATCH', 'The candidate package entry points differ from the reviewed Level 2 route.', { expected: lock.activationRoute.packageJson, actual: identity });
      }
      await writeBytesAtomic(this.workspaceRoot, 'package.json', bytes);
      return { status: 'ok', packageJson: await hashFile(this.workspaceRoot, 'package.json') };
    } catch (error) {
      return failure(error);
    }
  }

  async history() {
    try { return { status: 'ready', entries: await readHistory(this.workspaceRoot), guarantees: guaranteeCard() }; }
    catch (error) { return failure(error); }
  }
}
