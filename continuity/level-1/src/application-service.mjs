import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { assertNoForbiddenClaim, guaranteeCard } from './core.mjs';
import { mapClaudeCodeInvocation } from './claude-code-adapter.mjs';
import { LEVEL1_PATHS, identifyRepository, readJson, resolveWithin, verifyLock, writeJsonAtomic } from './repository-infrastructure.mjs';

function failure(code, message, details = undefined, remediation = undefined) {
  return { status: 'blocked', code, message, details, remediation, guarantees: guaranteeCard() };
}

export class Level1ApplicationService {
  constructor(repoRoot) {
    this.repoRoot = resolve(repoRoot);
  }

  async load() {
    const [manifest, procedure, binding, lock, activation] = await Promise.all([
      readJson(this.repoRoot, LEVEL1_PATHS.manifest),
      readJson(this.repoRoot, LEVEL1_PATHS.procedure),
      readJson(this.repoRoot, LEVEL1_PATHS.binding),
      readJson(this.repoRoot, LEVEL1_PATHS.lock),
      readJson(this.repoRoot, LEVEL1_PATHS.activation)
    ]);
    return { manifest, procedure, binding, lock, activation };
  }

  validateIdentity({ manifest, procedure, binding, lock }) {
    const memberships = manifest?.procedures ?? [];
    const keys = memberships.map((item) => `${item.id}@${item.version}`);
    if (memberships.length !== 1 || new Set(keys).size !== keys.length) {
      return failure('DUPLICATE_PROCEDURE_IDENTITY', 'Level 1 requires exactly one unique Procedure membership.', { memberships });
    }
    const expected = `${procedure.identity.id}@${procedure.identity.version}`;
    if (keys[0] !== expected || binding.procedure.id !== procedure.identity.id || binding.procedure.version !== procedure.identity.version) {
      return failure('IDENTITY_MISMATCH', 'Pack, Procedure, and project binding identities do not match.', { packMembership: keys[0], procedure: expected, binding: `${binding.procedure.id}@${binding.procedure.version}` });
    }
    if (manifest.assets.root !== lock.assetRoot || binding.procedure.skillRoot !== lock.assetRoot) {
      return failure('ASSET_ROOT_MISMATCH', 'Pack manifest, project binding, and exact lock do not name the same asset root.', {
        manifest: manifest.assets.root,
        binding: binding.procedure.skillRoot,
        lock: lock.assetRoot
      });
    }
    const assetPaths = (lock.assets ?? []).map((asset) => asset.path);
    if (new Set(assetPaths).size !== assetPaths.length) {
      return failure('DUPLICATE_ASSET_SOURCE', 'The exact lock resolves an asset source more than once.', { assetPaths });
    }
    return { status: 'ok' };
  }

  async preflight({ claim } = {}) {
    try {
      assertNoForbiddenClaim(claim);
      const config = await this.load();
      const identity = this.validateIdentity(config);
      if (identity.status !== 'ok') return identity;
      const repository = await identifyRepository(this.repoRoot, config.binding);
      if (!repository.recognized) {
        return failure('REPOSITORY_IDENTITY_MISMATCH', 'Repository identity markers are missing.', repository.markers, 'Run from the Nestfolio repository root or restore the declared markers.');
      }
      const missingPrerequisites = [];
      for (const prerequisite of config.procedure.prerequisites ?? []) {
        if (prerequisite.type === 'file' && !existsSync(resolveWithin(this.repoRoot, prerequisite.path))) {
          missingPrerequisites.push(prerequisite);
        }
        if (prerequisite.type === 'capability') {
          const evidence = prerequisite.evidence ?? [];
          const capabilityPresent = evidence.every((path) => existsSync(resolveWithin(this.repoRoot, path)));
          if (!capabilityPresent) missingPrerequisites.push(prerequisite);
        }
      }
      if (missingPrerequisites.length) {
        return failure('MISSING_PREREQUISITE', 'One or more declared prerequisites are missing.', missingPrerequisites, missingPrerequisites.map((item) => item.remediation).filter(Boolean));
      }
      const lockResult = await verifyLock(this.repoRoot, config.lock);
      if (!lockResult.ok) {
        return failure(lockResult.failures[0]?.code ?? 'LOCK_VERIFICATION_FAILED', 'Exact asset verification failed before Skill execution.', lockResult.failures, 'Restore the reviewed asset bytes or regenerate and review a new exact lock.');
      }
      return { status: 'ready', config, repository, lockResult, guarantees: guaranteeCard() };
    } catch (error) {
      return failure(error.code ?? 'LEVEL1_FAILURE', error.message);
    }
  }

  async doctor() {
    const result = await this.preflight();
    if (result.status !== 'ready') return result;
    return {
      status: 'ready',
      repository: result.repository,
      activation: result.config.activation,
      guarantees: result.guarantees,
      nextSafeAction: result.config.activation.active ? 'inspect or invoke nestfolio.backlog-next' : 'activate Level 1 or invoke /backlog-next directly'
    };
  }

  async inspect() {
    const result = await this.preflight();
    if (result.status !== 'ready') return result;
    const { manifest, procedure, binding, lock, activation } = result.config;
    return {
      status: 'ready',
      activation,
      guarantees: result.guarantees,
      repository: result.repository,
      pack: manifest.pack,
      procedure,
      binding,
      lock: {
        algorithm: lock.algorithm,
        lockDigest: lock.lockDigest,
        assets: result.lockResult.verified
      },
      authority: {
        procedureContract: LEVEL1_PATHS.procedure,
        packManifest: LEVEL1_PATHS.manifest,
        projectBinding: LEVEL1_PATHS.binding,
        executorAssets: binding.procedure.skillRoot,
        packLock: LEVEL1_PATHS.lock
      }
    };
  }

  async invoke(args = [], { claim } = {}) {
    const result = await this.preflight({ claim });
    if (result.status !== 'ready') return result;
    if (!result.config.activation.active) {
      return failure('LEVEL1_DISABLED', 'Continuity Level 1 activation is disabled. Direct /backlog-next invocation remains available.', undefined, 'Invoke /backlog-next directly or reactivate Level 1.');
    }
    return mapClaudeCodeInvocation({
      repository: result.repository,
      pack: result.config.manifest,
      procedure: result.config.procedure,
      binding: result.config.binding,
      lock: result.config.lock,
      args
    });
  }

  async activate() {
    const result = await this.preflight();
    if (result.status !== 'ready') return result;
    return this.setActivation(true);
  }

  async setActivation(active) {
    let activation;
    try {
      activation = await readJson(this.repoRoot, LEVEL1_PATHS.activation);
    } catch (error) {
      return failure(error.code ?? 'ACTIVATION_FAILURE', error.message);
    }
    const next = { ...activation, active: Boolean(active) };
    await writeJsonAtomic(this.repoRoot, LEVEL1_PATHS.activation, next);
    return { status: 'ok', activation: next, guarantees: guaranteeCard() };
  }
}
