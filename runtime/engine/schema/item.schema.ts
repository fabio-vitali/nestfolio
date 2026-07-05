// runtime/engine/schema/item.schema.ts — ring-1
// The item is the atom of WORK (§10). Ring-1 keeps it abstract; the project seam binds values.
// Re-frozen 2026-07-05 (runtime-item-schema-reconciliation): done_when identity binding, passthrough extensions.
import { z } from 'zod';
import { formatZodError } from './finding.schema.ts';

export type ItemId = string;
export type ItemStatus = string;  // project binds the values (active|queued|parking|shipped|dropped)
export type ItemType = string;    // project binds (bug|design|spec|epic|feature)

export const ItemSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  status: z.string().min(1),
  rank: z.number().nullish(),                           // the ONLY stored priority input (law 2); real store carries rank: null
  epic: z.string().optional(),                          // single-parent pointer (1-level tree)
  epic_role: z.enum(['core', 'captured']).optional(),
  done_when: z.string().min(1).optional(),              // the closure predicate — identity with the store key (re-freeze
                                                        //   2026-07-05); requiredness is a project rule (lint 4b), not ring-1's
  scope: z.string().optional(),                         // path-glob-shaped (NOT free prose) — feeds findByScope
  out_of_scope: z.array(z.string()).optional(),
  references: z.array(z.string()).optional(),
  provenance: z.object({
    from_finding: z.string().optional(),               // FindingId (§15 delta 2) — which finding
    from_check: z.string().optional(),                 // CheckId (denormalized for query) — which check
  }).strict().optional(),
}).passthrough();                                       // project-local extensions (spec/plan/notes/closed/…) ride through
export type Item = z.infer<typeof ItemSchema>;

export function validateItem(obj: unknown) {
  const r = ItemSchema.safeParse(obj);
  return r.success ? { ok: true, value: r.data } : { ok: false, error: formatZodError(r.error) };
}
