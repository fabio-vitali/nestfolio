import { guaranteeCard, sha256Text, stableJson } from './core.mjs';

export function mapClaudeCodeInvocation({ repository, pack, procedure, binding, lock, args, now = new Date() }) {
  const payload = {
    adapter: 'claude-code',
    mode: 'repository-skill',
    repository: { id: repository.id, fingerprint: repository.fingerprint },
    pack: `${pack.pack.id}@${pack.pack.version}`,
    procedure: `${procedure.identity.id}@${procedure.identity.version}`,
    entryPoint: binding.procedure.entryPoint,
    primaryAsset: binding.procedure.primaryAsset,
    lockDigest: lock.lockDigest,
    arguments: args
  };
  return {
    status: 'ready',
    guarantees: guaranteeCard(),
    ...payload,
    delegation: {
      action: 'invoke-repository-skill',
      command: [binding.procedure.entryPoint, ...args].join(' ').trim(),
      behaviorAuthority: procedure.behaviorAuthority,
      instruction: `Invoke ${binding.procedure.entryPoint}${args.length ? ` ${args.join(' ')}` : ''} using the existing locked repository Skill. Do not reinterpret or reimplement its semantics.`
    },
    provenance: {
      generatedAt: now.toISOString(),
      invocationDigest: sha256Text(stableJson(payload)),
      persistedAsCanonicalState: false,
      transcriptOrHiddenStateAuthoritative: false
    }
  };
}
