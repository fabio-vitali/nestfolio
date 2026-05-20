/* tier-filter.ts — apply a tier predicate from tiers.json to a synthetic
 * catalog. Pure logic; the catalog itself is assembled in refresh-models.ts.
 *
 * Family matcher supports two forms:
 *   - "vendor.familyPrefix"        → prefix match against modelId, stripping us./eu./apac.
 *   - "vendor.familyPrefix-N-M+"   → same, but the "Nx.Mx or newer" version gate
 *     parses the version embedded in the modelId.
 */

import type { Tier } from './types';
import type { SizeClass } from './catalog-loader';
import type tiersJson from '../tiers.json';

export interface CatalogEntry {
  readonly modelId: string;
  readonly sizeClass: SizeClass;
  readonly contextWindow: number;
}

type TiersJson = typeof tiersJson;

function stripRegionPrefix(modelId: string): string {
  return modelId.replace(/^(us|eu|apac|global)\./, '');
}

/** Parse a version-gate from a "vendor.family-N-M+" string into a comparator.
 * Examples:
 *   meta.llama3-3+   → { vendor: 'meta.llama', major: 3, minor: 3, gate: '+' }
 *   meta.llama4+     → { vendor: 'meta.llama', major: 4, minor: 0, gate: '+' }
 *   anthropic        → { vendor: 'anthropic', major: 0, minor: 0, gate: null }
 */
interface FamilyMatcher {
  readonly raw: string;
  readonly prefix: string;
  readonly minMajor: number | null;
  readonly minMinor: number;
}

function parseFamilyMatcher(raw: string): FamilyMatcher {
  const versionGate = /^(.+?)(\d+)(?:-(\d+))?\+$/.exec(raw);
  if (versionGate) {
    return {
      raw,
      prefix: versionGate[1],
      minMajor: Number(versionGate[2]),
      minMinor: versionGate[3] !== undefined ? Number(versionGate[3]) : 0,
    };
  }
  return { raw, prefix: raw, minMajor: null, minMinor: 0 };
}

/** Extract version numbers from a modelId. The version may sit immediately after
 * the family prefix (e.g. `meta.llama` + `3-3-70b…`) OR after an intermediate
 * family-name segment (e.g. `anthropic.claude-` + `sonnet-4-6` — Anthropic puts
 * the family name (sonnet/opus/haiku) between the vendor prefix and the version).
 * Pick the first numeric run that is either at the start of the tail or
 * preceded by a dash. The second number must NOT be followed by `\d` or `b`
 * (avoids treating a param-count token like `70b` as a minor version, and
 * avoids gluing a date suffix `-20251001` onto the minor). */
function extractVersion(modelId: string, prefix: string): { major: number; minor: number } | null {
  const stripped = stripRegionPrefix(modelId);
  if (!stripped.startsWith(prefix)) return null;
  const tail = stripped.slice(prefix.length);
  const m = /(?:^|-)(\d+)(?:[.\-](\d+)(?![\db]))?/.exec(tail);
  if (!m) return null;
  return { major: Number(m[1]), minor: m[2] !== undefined ? Number(m[2]) : 0 };
}

function matchesFamily(modelId: string, matcher: FamilyMatcher): boolean {
  const stripped = stripRegionPrefix(modelId);
  if (!stripped.startsWith(matcher.prefix)) return false;
  if (matcher.minMajor === null) return true;
  const version = extractVersion(modelId, matcher.prefix);
  if (!version) return false;
  if (version.major > matcher.minMajor) return true;
  if (version.major < matcher.minMajor) return false;
  return version.minor >= matcher.minMinor;
}

export function filterCatalogByTier(
  catalog: readonly CatalogEntry[],
  tier: Tier,
  tiers: TiersJson,
): readonly CatalogEntry[] {
  const def = tiers[tier] as {
    families: readonly string[];
    sizeClass: readonly SizeClass[];
    minContextWindow?: number;
  };
  const familyMatchers = def.families.map(parseFamilyMatcher);
  const sizeClassSet = new Set<SizeClass>(def.sizeClass);
  const minCtx = def.minContextWindow ?? 0;

  const filtered = catalog.filter((e) => {
    if (!sizeClassSet.has(e.sizeClass)) return false;
    if (e.contextWindow < minCtx) return false;
    return familyMatchers.some((fm) => matchesFamily(e.modelId, fm));
  });

  const rank: Record<SizeClass, number> = { frontier: 0, mid: 1, cheap: 2 };
  return [...filtered].sort((a, b) => {
    const r = rank[a.sizeClass] - rank[b.sizeClass];
    return r !== 0 ? r : a.modelId.localeCompare(b.modelId);
  });
}
