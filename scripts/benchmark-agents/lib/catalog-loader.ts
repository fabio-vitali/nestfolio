/* catalog-loader.ts — vendor classification for Bedrock modelIds + us.*
 * preference dedup. Pure logic; no AWS SDK calls (those live in refresh-models.ts).
 */

export type SizeClass = 'frontier' | 'mid' | 'cheap';

interface SizeClassRule {
  readonly match: (modelId: string) => boolean;
  readonly sizeClass: SizeClass;
}

const SIZE_CLASS_RULES: readonly SizeClassRule[] = [
  // Anthropic
  { match: (id) => /anthropic\.claude-opus/.test(id), sizeClass: 'frontier' },
  { match: (id) => /anthropic\.claude-sonnet/.test(id), sizeClass: 'frontier' },
  { match: (id) => /anthropic\.claude-haiku/.test(id), sizeClass: 'mid' },
  // Amazon Nova
  { match: (id) => /amazon\.nova-premier/.test(id), sizeClass: 'frontier' },
  { match: (id) => /amazon\.nova-pro/.test(id), sizeClass: 'frontier' },
  { match: (id) => /amazon\.nova-lite/.test(id), sizeClass: 'mid' },
  { match: (id) => /amazon\.nova-micro/.test(id), sizeClass: 'cheap' },
  // Meta Llama — match size token in the modelId
  { match: (id) => /meta\.llama.*-(70b|405b)-/.test(id), sizeClass: 'frontier' },
  { match: (id) => /meta\.llama.*-(maverick|scout|17b)-/i.test(id), sizeClass: 'mid' },
  { match: (id) => /meta\.llama.*-(8b|1b|3b|11b)-/.test(id), sizeClass: 'cheap' },
  // Mistral
  { match: (id) => /mistral\.mistral-large/.test(id), sizeClass: 'frontier' },
];

export function sizeClassFor(modelId: string): SizeClass | 'unknown' {
  return SIZE_CLASS_RULES.find((r) => r.match(modelId))?.sizeClass ?? 'unknown';
}

/** Strip base modelId when a `us.<base>` cross-region variant exists. Keeps
 * eu.* / apac.* / other prefixes alongside us.*. Per CLAUDE.md memory:
 * production uses inference-profile IDs (us.*), so the benchmark should too. */
export function dedupeUsStarPreference(modelIds: readonly string[]): string[] {
  const set = new Set(modelIds);
  const usStarBases = new Set<string>();
  for (const id of set) {
    if (id.startsWith('us.')) usStarBases.add(id.slice('us.'.length));
  }
  return [...set].filter((id) => !usStarBases.has(id));
}
