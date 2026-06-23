import { createHash } from 'node:crypto';

/** Canonical, STRUCTURED fork subject (never free prose) — the second half of fork_key. */
export function canonicalSubject({ reason, symbol, designSliceId }) {
  if (reason === 'design-approval') {
    if (!designSliceId) throw new Error('canonicalSubject: design-approval requires designSliceId');
    return `design-approval:${designSliceId}`;
  }
  if (!symbol) throw new Error('canonicalSubject: a scope/floor fork requires the symbol (the exact arg passed to detect-fork-blast-radius)');
  return `${reason}:${symbol}`;
}

/** Deterministic fork identity. SAME (member, canonicalForkSubject) => SAME key on every (re)dispatch. */
export function forkKey(member, canonicalForkSubject) {
  if (!member || !canonicalForkSubject) throw new Error('forkKey requires member + canonicalForkSubject');
  return createHash('sha256').update(`${member} ${canonicalForkSubject}`).digest('hex');
}
