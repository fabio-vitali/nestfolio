import { createHash } from 'node:crypto';

export const LEVEL_2_GUARANTEES = Object.freeze({
  adoption: 'Level 2 of 6',
  active: Object.freeze([
    'exactly two immutable Pack versions selected by one composed workspace lock',
    'exactly one Pack, Procedure specification, and executor asset mapping per Procedure identity',
    'deterministic local exact-version resolution without ranges or network lookup',
    'SHA-256 and byte-size verification for selected manifests, specifications, and executor assets',
    'Pack self-validation, compatibility, capability, permission, deprecation, and conflict diagnostics',
    'compare-and-swap activation with exact activation history',
    'explicit comparison and byte-exact rollback to the retained Level 1 route'
  ]),
  absent: Object.freeze({
    level3: Object.freeze(['product-owned Work selection', 'Work Item', 'Working Set', 'Scope', 'completion criteria', 'backlog authority']),
    level4: Object.freeze(['Context Pack', 'Formation Trace', 'context authorization', 'refresh', 'expiration', 'revocation']),
    level5: Object.freeze(['Session', 'Run', 'effect', 'lease', 'Checkpoint', 'Handoff', 'interruption recovery', 'resume']),
    level6: Object.freeze(['Assurance Evidence authority', 'Validation Plan', 'Guard', 'Waiver', 'completion transition', 'Decision', 'Observation', 'Lesson', 'promotion']),
    broader: Object.freeze(['remote Pack registry', 'remote Pack source', 'signing service', 'marketplace', 'dependency solver', 'override language', 'external write integration', 'hosted service'])
  })
});

export const FORBIDDEN_CLAIMS = new Set([
  'work', 'work-item', 'working-set', 'scope', 'completion', 'context',
  'context-pack', 'formation-trace', 'session', 'run', 'effect', 'checkpoint',
  'handoff', 'assurance', 'evidence', 'guard', 'waiver', 'decision',
  'observation', 'lesson', 'learning', 'registry', 'remote-source'
]);

export const REUSABLE_FORBIDDEN_MARKERS = Object.freeze([
  'nestfolio', '/backlog-next', 'docs/backlog', 'backlog-next',
  'lane classification', 'deploy-needed', 'epic_role', 'validation_gate'
]);

export class ContinuityLevel2Error extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'ContinuityLevel2Error';
    this.code = code;
    this.details = details;
  }
}

export function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function sortedValue(value) {
  if (Array.isArray(value)) return value.map(sortedValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortedValue(value[key])]));
  }
  return value;
}

export function canonicalJson(value) {
  return `${JSON.stringify(sortedValue(value), null, 2)}\n`;
}

export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function aggregateMaterial(lock) {
  const { aggregate, ...material } = lock;
  return material;
}

export function computeAggregateDigest(lock) {
  return sha256(stableJson(aggregateMaterial(lock)));
}

export function guaranteeCard() {
  return {
    adoption: LEVEL_2_GUARANTEES.adoption,
    active: [...LEVEL_2_GUARANTEES.active],
    absent: Object.fromEntries(Object.entries(LEVEL_2_GUARANTEES.absent).map(([key, items]) => [key, [...items]]))
  };
}

export function assertNoForbiddenClaim(claim) {
  if (!claim) return;
  const normalized = String(claim).trim().toLowerCase();
  if (FORBIDDEN_CLAIMS.has(normalized)) {
    throw new ContinuityLevel2Error(
      'FORBIDDEN_HIGHER_LEVEL_CLAIM',
      `Level 2 cannot create or claim '${normalized}'. Levels 3-6 and broader services remain deliberately absent.`,
      { claim: normalized }
    );
  }
}

export function failure(error, fallback = 'LEVEL2_FAILURE') {
  return {
    status: 'blocked',
    code: error?.code ?? fallback,
    message: error?.message ?? String(error),
    details: error?.details,
    guarantees: guaranteeCard()
  };
}
