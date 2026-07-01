// find-by-scope.mjs — findByScope(): the scoped wake. Retrieval-scoped `checks` + ALWAYS-full
// `invariants`. Scoping narrows retrieval (dossiers, expensive audits), never the enforcement floor (§6/§11).
import { globsOverlap } from './glob-overlap.mjs';

const toGlobSet = (scope) => Array.isArray(scope) ? scope : String(scope ?? '').split(/[\s\n]+/).filter(Boolean);

export function findByScope({ registry, scope }) {
  const itemGlobs = toGlobSet(scope);
  const active = registry.checks.filter((c) => c.status === 'active');
  const overlaps = (c) => c.scope.paths.some((cp) => itemGlobs.some((ig) => globsOverlap(cp, ig)));
  const checks = active.filter(overlaps);
  const invariants = active.filter((c) => c.contexts.includes('invariant'));
  return { checks, invariants };
}
