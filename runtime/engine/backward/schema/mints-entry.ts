// runtime/engine/backward/schema/mints-entry.ts — ring-1; the reciprocal of the check's
// Provenance.lesson (§7.1). Derived-and-reconciled by reconcileLesson (its ONLY writer).
import { z } from 'zod';
import { formatZodError } from '../../schema/finding.schema.ts';

export const MintsEntrySchema = z.object({
  check: z.string().min(1),                                 // CheckId this lesson minted
  ratified: z.string().min(1),                              // ISO date; mirrors check.provenance.ratified
  status: z.enum(['active', 'superseded', 'retired']),      // tracks the minted check's live-or-terminal state
  superseded_by: z.string().optional(),                    // CheckId; set together with status: 'superseded'
}).strict().superRefine((e, ctx) => {
  if (e.status === 'superseded' && !e.superseded_by) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['superseded_by'],
      message: "status 'superseded' requires superseded_by" });
  }
});
export type MintsEntry = z.infer<typeof MintsEntrySchema>;

export function validateMintsEntry(obj: unknown) {
  const r = MintsEntrySchema.safeParse(obj);
  return r.success ? { ok: true, value: r.data } : { ok: false, error: formatZodError(r.error) };
}
