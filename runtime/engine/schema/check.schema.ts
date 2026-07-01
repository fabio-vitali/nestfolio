// runtime/engine/schema/check.schema.ts — ring-1 SOURCE OF TRUTH for the check atom (§4).
// zod validators + z.infer types in one file; SPEC 2 & 3 consume these verbatim.
import { z } from 'zod';
import { FindingKindSchema, formatZodError } from './finding.schema.ts';

export type CheckId = string;
export const CostTierSchema = z.enum(['cheap', 'moderate', 'expensive']);
export type CostTier = z.infer<typeof CostTierSchema>;
export const ContextSchema = z.enum(['gate', 'audit', 'invariant']);
export type Context = z.infer<typeof ContextSchema>;
export const CheckStatusSchema = z.enum(['candidate', 'active', 'superseded', 'retired']);
export type CheckStatus = z.infer<typeof CheckStatusSchema>;
export type EvaluatorKind = 'deterministic' | 'judgment';

// The closed run-scheme set (§4). The scheme is the sole disambiguator; a bare run is a load error.
export const RUN_SCHEMES = ['cmd', 'module', 'eslint', 'skill'] as const;
export type RunScheme = (typeof RUN_SCHEMES)[number];

/** Pure grammar parser: "<scheme>:<target>" with a known scheme, else null.
 *  `run: string` (zod validates it as a string before this is ever called); the `as readonly
 *  string[]` cast is required because RUN_SCHEMES is `as const` (a literal tuple) and `.includes`
 *  of a widened `string` would not typecheck under `strict`. */
export function parseRun(run: string) {
  const idx = typeof run === 'string' ? run.indexOf(':') : -1;
  if (idx <= 0) return null;
  const scheme = run.slice(0, idx);
  if (!(RUN_SCHEMES as readonly string[]).includes(scheme)) return null;
  const target = run.slice(idx + 1);
  return target.length ? { scheme, target } : null;
}
const runHasValidScheme = (run: string) => parseRun(run) !== null;

const DeterministicEvaluatorSchema = z.object({
  type: z.literal('deterministic'),
  run: z.string().refine(runHasValidScheme, { message: 'run must be <scheme>:<target> with scheme in cmd|module|eslint|skill' }),
  fix: z.string().optional(),
}).strict();
const JudgmentEvaluatorSchema = z.object({
  type: z.literal('judgment'),
  run: z.string().refine(runHasValidScheme, { message: 'run must be <scheme>:<target>' }),
}).strict();
export const EvaluatorSchema = z.discriminatedUnion('type', [DeterministicEvaluatorSchema, JudgmentEvaluatorSchema]);
export type Evaluator = z.infer<typeof EvaluatorSchema>;

export const ScopeSchema = z.object({
  paths: z.array(z.string()),
  dossiers: z.array(z.string()).optional(),
  exclusions: z.string().optional(),
}).strict();
export type Scope = z.infer<typeof ScopeSchema>;

export const FlakeContractSchema = z.object({
  eval_scenario: z.string().min(1),
  allowed_flake_rate: z.number().min(0).max(1),
  calibration: z.string().min(1),
  min_confidence: z.number().min(0).max(1).optional(),
}).strict();
export type FlakeContract = z.infer<typeof FlakeContractSchema>;

export const ProvenanceSchema = z.object({
  minted_by: z.string().min(1),          // item/lesson id, or the reserved "starter-pack" (§15 delta 3)
  lesson: z.string().optional(),
  ratified: z.string().optional(),        // OPTIONAL (§15 delta 1): a candidate has none yet
  supersedes: z.string().optional(),
  superseded_by: z.string().optional(),
  retired_reason: z.string().optional(),
}).strict();
export type Provenance = z.infer<typeof ProvenanceSchema>;

export const CheckEntrySchema = z.object({
  id: z.string().min(1),
  property: z.string().min(1),
  kind: FindingKindSchema,
  evaluator: EvaluatorSchema,
  cost_tier: CostTierSchema,
  contexts: z.array(ContextSchema).nonempty(),
  scope: ScopeSchema,
  status: CheckStatusSchema,
  flake_contract: FlakeContractSchema.optional(),
  provenance: ProvenanceSchema,
}).strict().superRefine((check, ctx) => {
  // The one cross-field rule the SCHEMA owns: judgment ⇒ flake_contract present (§4, §8 assertion 3, §9).
  if (check.evaluator.type === 'judgment' && !check.flake_contract) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['flake_contract'],
      message: 'a judgment check must carry a flake_contract' });
  }
});
export type CheckEntry = z.infer<typeof CheckEntrySchema>;

export function validateCheck(obj: unknown) {
  const r = CheckEntrySchema.safeParse(obj);
  return r.success ? { ok: true, value: r.data } : { ok: false, error: formatZodError(r.error) };
}
