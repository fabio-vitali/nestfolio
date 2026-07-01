// runtime/engine/backward/schema/eval-landing.ts — ring-1, SPEC 2 §9.
// The handoff contract SPEC 2 guarantees the SPEC-3 harness receives on ratify / superseding mint.
import { z } from 'zod';
import { FlakeContractSchema } from '../../schema/check.schema.ts';
import { formatZodError } from '../../schema/finding.schema.ts';

export const EvalScenarioLandingSchema = z.object({
  check: z.string().min(1),
  evaluator_kind: z.enum(['deterministic', 'judgment']),
  scenario_path: z.string().min(1),
  fixtures: z.object({ good: z.array(z.string()), bad: z.array(z.string()) }).strict(),
  flake_contract: FlakeContractSchema.optional(),          // REQUIRED iff judgment
  registered_via: z.literal('harness:landScenario'),
}).strict().superRefine((l, ctx) => {
  if (l.evaluator_kind === 'judgment' && !l.flake_contract) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['flake_contract'], message: 'a judgment landing must carry a flake_contract' });
  }
});
export type EvalScenarioLanding = z.infer<typeof EvalScenarioLandingSchema>;

export function validateEvalScenarioLanding(obj: unknown) {
  const r = EvalScenarioLandingSchema.safeParse(obj);
  return r.success ? { ok: true, value: r.data } : { ok: false, error: formatZodError(r.error) };
}
