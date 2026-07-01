// runtime/engine/backward/schema/floor-choice.ts — ring-1, SPEC 2 §6.1.
// The two ask(decision)→choice payloads. A real bounded choice with exactly one recommended.
import { z } from 'zod';
import { CheckEntrySchema } from '../../schema/check.schema.ts';
import { FindingSchema } from '../../schema/finding.schema.ts';

export const MintChoiceSchema = z.object({
  act: z.literal('mint'),
  candidate: CheckEntrySchema,                             // status: 'candidate' (the §4.1 draft's entry)
  lesson: z.string().min(1),
  rationale: z.string().min(1),
  recommended: z.literal('ratify'),                        // deterministic-first drafts default to ratify
  options: z.tuple([z.literal('ratify'), z.literal('edit'), z.literal('decline')]),
}).strict();
export type MintChoice = z.infer<typeof MintChoiceSchema>;

export const CurateChoiceSchema = z.object({
  act: z.literal('curate'),
  guard: CheckEntrySchema,
  trigger: z.enum(['ship-gate-blocking', 'dangling-scope']),
  finding: FindingSchema,
  proposed_successor: CheckEntrySchema.optional(),
  rationale: z.string(),                                   // sync: WHY the property is no longer intended
  recommended: z.enum(['keep', 'supersede', 'retire']),
  options: z.tuple([z.literal('retire'), z.literal('supersede'), z.literal('keep')]),
}).strict();
export type CurateChoice = z.infer<typeof CurateChoiceSchema>;

export const FloorChoiceSchema = z.discriminatedUnion('act', [MintChoiceSchema, CurateChoiceSchema]);
export type FloorChoice = z.infer<typeof FloorChoiceSchema>;
