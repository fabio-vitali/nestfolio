// runtime/engine/schema/journal.schema.ts — ring-1 journal TYPES (§5).
// SPEC 1 convention: *types* live in *.schema.ts, *helpers* in .mjs. The journal's shapes live
// HERE, imported by BOTH capabilities/index.ts (§4) and lib/journal.mjs (defined once).
import { z } from 'zod';
import type { Decision, Choice } from '../capabilities/index.ts'; // §4.1 — type-only; cycle erased
import { formatZodError } from './finding.schema.ts';

export type RunId = string;         // `item-<id>` | `epic-<id>` — STABLE across wakes
export type StepKey = string;       // `<phase>.<name>` e.g. "E1.promote"
export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

export const STEP_STRATEGIES = ['pure-rederive', 'keyed-effect', 'external-idempotent'] as const;
export type StepStrategy = (typeof STEP_STRATEGIES)[number];

export const RunMetaSchema = z.object({
  runId: z.string().min(1),
  branch: z.string().min(1),
  worktree: z.string().min(1),
  auto: z.boolean(),
}).strict();
export type RunMeta = z.infer<typeof RunMetaSchema>;

// A DecisionSchema-lite for record validation (the full Decision lives as a TS type in capabilities;
// here we validate just enough that a parked ask round-trips through NDJSON).
const RecordedDecisionSchema = z.object({
  id: z.string().min(1),
  question: z.string().min(1),
  options: z.array(z.object({ label: z.string(), value: z.string(), recommended: z.boolean().optional() }).strict()).min(1),
  irreversible: z.boolean().optional(),
  context: z.string().optional(),
}).strict();

export const StepRecordSchema = z.object({
  key: z.string().min(1),
  status: z.enum(['complete', 'awaiting']),
  value: z.unknown().optional(),           // Json at the type level; unknown at the zod edge (NDJSON round-trip)
  decision: RecordedDecisionSchema.optional(),
  ts: z.string().min(1),
}).strict();
export type StepRecord = { key: StepKey; status: 'complete' | 'awaiting'; value?: Json; decision?: Decision; ts: string };

export interface RunLedger { meta: RunMeta; steps: Map<StepKey, StepRecord>; }

export interface Journal {
  begin(runId: RunId, meta: RunMeta): void;                     // idempotent: existing run → NOOP (FRESH-vs-RESUME)
  step<T>(runId: RunId, key: StepKey, fn: () => Promise<T>, strategy?: StepStrategy): Promise<T>;
  record(runId: RunId, key: StepKey, value: Json): void;        // append-only annotation (decisions[], e2e)
  read(runId: RunId): RunLedger | null;                         // null ⇒ FRESH
  awaiting(runId: RunId, key: StepKey, decision: Decision): void;
  fulfil(runId: RunId, key: StepKey, choice: Choice): void;
}

export function validateStepRecord(obj: unknown) {
  const r = StepRecordSchema.safeParse(obj);
  return r.success ? { ok: true, value: r.data } : { ok: false, error: formatZodError(r.error) };
}
export function validateRunMeta(obj: unknown) {
  const r = RunMetaSchema.safeParse(obj);
  return r.success ? { ok: true, value: r.data } : { ok: false, error: formatZodError(r.error) };
}
