// runtime/engine/backward/schema/candidate-draft.ts — ring-1, SPEC 2 §4.1.
// The worker's post-ship draft: a candidate CheckEntry + what the floor needs to rule and the
// mint needs to land. Encodes Δ2 (a candidate carries NO provenance.ratified).
import { z } from 'zod';
import { CheckEntrySchema } from '../../schema/check.schema.ts';
import { formatZodError } from '../../schema/finding.schema.ts';

export const EvalScenarioDraftSchema = z.object({
  path: z.string().min(1),                                  // where it WILL land on ratify
  fixtures: z.object({ good: z.array(z.string()), bad: z.array(z.string()) }).strict(),
  target_pass_rate: z.number().min(0).max(1),               // judgment: flake budget = 1 - this; deterministic: 1.0
}).strict();
export type EvalScenarioDraft = z.infer<typeof EvalScenarioDraftSchema>;

export const CandidateDraftSchema = z.object({
  entry: CheckEntrySchema,
  eval_scenario: EvalScenarioDraftSchema,
  rationale: z.string().min(1),                             // the §8 mint-heuristic answer
  supersedes_candidate: z.string().optional(),             // CheckId this draft would REPLACE (routes to curate-supersede)
}).strict().superRefine((draft, ctx) => {
  if (draft.entry.status !== 'candidate') {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['entry', 'status'],
      message: "a draft's entry.status must be 'candidate'" });
  }
  if (draft.entry.provenance.ratified !== undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['entry', 'provenance', 'ratified'],
      message: 'a candidate draft must NOT carry provenance.ratified (stamped on ratify)' });
  }
});
export type CandidateDraft = z.infer<typeof CandidateDraftSchema>;

export function validateCandidateDraft(obj: unknown) {
  const r = CandidateDraftSchema.safeParse(obj);
  return r.success ? { ok: true, value: r.data } : { ok: false, error: formatZodError(r.error) };
}
