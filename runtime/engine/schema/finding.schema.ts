// runtime/engine/schema/finding.schema.ts — ring-1, project-agnostic
// The Finding is the currency of the forward edge (§3). Defined here because SPEC 3 intake consumes it.
import { z } from 'zod';

export const FindingKindSchema = z.enum(['drift', 'inconsistency', 'gap', 'staleness']);
export type FindingKind = z.infer<typeof FindingKindSchema>;

// FindingId / CheckId are opaque strings at ring-1; branding is a downstream concern.
export type FindingId = string;

// Reserved provenance sentinel: an agent-*observed* side-finding with no originating check (§7 Hole #1 /
// D-D1). Mirrors the "starter-pack" minted_by sentinel (check.schema.ts:61) — a magic literal, not a new
// schema branch. A finding with check omitted, or check === AGENT_OBSERVED, is treated as check-less.
export const AGENT_OBSERVED = 'agent-observed';

export const FindingSchema = z.object({
  id: z.string().min(1),           // stable within a watch pass; carried into item provenance (§10)
  check: z.string().min(1).optional(), // the CheckId that raised it — omitted (or AGENT_OBSERVED) for agent-observed side-findings
  kind: FindingKindSchema,         // inherited from check.kind
  scope: z.array(z.string()),      // resolved paths/dossiers implicated
  detail: z.string().min(1),       // human-readable statement of the broken property
  evidence: z.string().optional(), // captured evaluator output (the "exit 0 ≠ pass" receipt)
  raised_at: z.string().min(1),    // ISO-8601
}).strict();
export type Finding = z.infer<typeof FindingSchema>;

/** Pure validator: never throws; returns a discriminated result with a located error string. */
export function validateFinding(obj: unknown) {
  const r = FindingSchema.safeParse(obj);
  return r.success ? { ok: true, value: r.data } : { ok: false, error: formatZodError(r.error) };
}

/** Shared zod-error formatter: "path: message; …" — reused by every schema validator.
 *  Params are explicitly typed because runtime/tsconfig.json is `strict` (noImplicitAny). */
export function formatZodError(error: z.ZodError) {
  return error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
}
