// runtime/engine/backward/schema/floor-decision.ts — ring-1, SPEC 2 §6.2.
// Append-only journaled record of a floor act. rationale REQUIRED for retire/supersede/decline.
import { z } from 'zod';
import { ProvenanceSchema } from '../../schema/check.schema.ts';
import { formatZodError } from '../../schema/finding.schema.ts';

export const FloorDecisionSchema = z.object({
  act: z.enum(['mint', 'curate']),
  transition: z.enum(['ratify', 'edit', 'decline', 'supersede', 'retire', 'keep']),
  check: z.string().min(1),
  successor: z.string().optional(),
  lesson: z.string().optional(),
  rationale: z.string(),
  provenance: ProvenanceSchema,
  decided_by: z.literal('human'),                          // ALWAYS human — never self-resolves in --auto
  decided_at: z.string().min(1),
  journal_key: z.string().min(1),
}).strict().superRefine((d, ctx) => {
  if (['retire', 'supersede', 'decline'].includes(d.transition) && !d.rationale.trim()) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['rationale'],
      message: `transition '${d.transition}' requires a non-empty rationale` });
  }
  if (d.transition === 'supersede' && !d.successor) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['successor'], message: "transition 'supersede' requires a successor" });
  }
});
export type FloorDecision = z.infer<typeof FloorDecisionSchema>;

export function validateFloorDecision(obj: unknown) {
  const r = FloorDecisionSchema.safeParse(obj);
  return r.success ? { ok: true, value: r.data } : { ok: false, error: formatZodError(r.error) };
}
