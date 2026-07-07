// runtime/content/lib/auto-resolve-policy.mjs — deterministic --auto per-source policy (backlog-next
// §"Standalone --auto mode"). Pure: (fork) → decision. Graded by the next-auto-* parity twins.
export function autoResolvePolicy(fork) {
  if (fork?.kind === 'design-approval') return 'pause';                                   // never self-approve a design
  if (fork?.irreversible || fork?.outwardFacing || fork?.blastRadius === 'shared') return 'hard-floor';
  if (fork?.kind === 'architectural' && fork?.blastRadius === 'local') return 'auto-resolve';
  return 'pause';                                                                          // unknown territory → pause
}
