import { createHash } from 'node:crypto';

export const LEVEL_1_GUARANTEES = Object.freeze({
  adoption: 'Level 1 of 6',
  active: [
    'one declared Procedure identity and version',
    'one minimal project-specific Pack manifest',
    'one Nestfolio project binding',
    'exact SHA-256 asset lock',
    'repository identity and activation diagnostic',
    'prerequisite and permission preflight',
    'explicit Claude Code entry point',
    'structured invocation result and provenance',
    'fail-closed missing or mismatched assets'
  ],
  absent: Object.freeze({
    level2: ['reusable multi-Procedure composition', 'Pack conflict or dependency solving'],
    level3: ['canonical Work', 'Working Set', 'Scope', 'completion criteria authority'],
    level4: ['Context Pack', 'Formation Trace', 'context authorization'],
    level5: ['Session', 'Run', 'effects', 'Checkpoint', 'Handoff', 'resume'],
    level6: ['Assurance Evidence', 'Guard', 'Waiver', 'completion authority', 'Decision', 'Observation', 'Lesson', 'learning promotion']
  })
});

export const FORBIDDEN_CLAIMS = new Set([
  'work', 'working-set', 'scope', 'context-pack', 'formation-trace', 'session',
  'run', 'effect', 'checkpoint', 'handoff', 'assurance', 'evidence', 'waiver',
  'guard', 'completion', 'decision', 'observation', 'lesson', 'learning'
]);

/**
 * Serializes a value to JSON with object keys sorted recursively, so that
 * two deep-equal values always produce the same string regardless of key order.
 * Returns the serialized string.
 */
export function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/**
 * Computes the SHA-256 digest of the given text.
 * Returns the digest as a lowercase hex string.
 */
export function sha256Text(value) {
  return createHash('sha256').update(value).digest('hex');
}

/**
 * Builds a plain-object snapshot of the Level 1 guarantee card, deep-copying
 * `LEVEL_1_GUARANTEES` so callers cannot mutate the frozen source.
 * Returns an object with `adoption`, `active`, and `absent` fields.
 */
export function guaranteeCard() {
  return {
    adoption: LEVEL_1_GUARANTEES.adoption,
    active: [...LEVEL_1_GUARANTEES.active],
    absent: Object.fromEntries(Object.entries(LEVEL_1_GUARANTEES.absent).map(([key, items]) => [key, [...items]]))
  };
}

/**
 * Guards against claiming a capability reserved for Levels 2-6.
 * Throws an `Error` with `code: 'FORBIDDEN_HIGHER_LEVEL_CLAIM'` if the
 * normalized claim is in `FORBIDDEN_CLAIMS`; otherwise returns nothing.
 */
export function assertNoForbiddenClaim(claim) {
  if (!claim) return;
  const normalized = String(claim).trim().toLowerCase();
  if (FORBIDDEN_CLAIMS.has(normalized)) {
    const error = new Error(`Level 1 cannot claim or create '${normalized}'. Levels 2-6 remain explicitly absent.`);
    error.code = 'FORBIDDEN_HIGHER_LEVEL_CLAIM';
    throw error;
  }
}
