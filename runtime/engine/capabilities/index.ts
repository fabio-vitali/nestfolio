// runtime/engine/capabilities/index.ts — the ONLY host surface ring-1 depends on (§4.1).
import type { Finding } from '../schema/finding.schema.ts';   // SPEC 1 §3, frozen
import type { Journal } from '../schema/journal.schema.ts';   // §5, defined once, re-exported here

export interface Task {
  id: string;                 // stable idempotency-key seed (feeds journal, §5)
  prompt: string;             // the work instruction — prompt-shaped by the adapter
  scope: string[];            // paths the task may touch (feeds the scope-gate, §9)
  procedure?: string;         // optional named sub-procedure (runProcedure)
  payload?: unknown;
}
export interface TaskResult {
  taskId: string;
  status: 'done' | 'failed' | 'paused';
  summary: string;            // bounded prose — NEVER a transcript
  findings?: Finding[];
}
export interface Summary {    // the ONLY thing fanOut returns (the Tier-2 scar)
  taskId: string;
  status: 'done' | 'failed';
  summary: string;            // a transcript here is a SEAM VIOLATION
}

export interface Decision {
  id: string;
  question: string;
  options: DecisionOption[];   // exactly one MUST carry recommended:true (house rule)
  irreversible?: boolean;      // hard-floor: ALWAYS pauses, even in --auto
  context?: string;
}
export interface DecisionOption { label: string; value: string; recommended?: boolean; }
export interface Choice { decisionId: string; value: string; rationale?: string; }

export type TriggerEvent =
  | { kind: 'manual' }
  | { kind: 'commit'; sha: string; changed: string[] }
  | { kind: 'merge';  branch: string; changed: string[] }
  | { kind: 'ci';     ref: string;    changed: string[] }
  | { kind: 'schedule'; cron: string };
export interface TriggerSpec { on: TriggerEvent['kind']; cron?: string; }
export type Unsubscribe = () => void;

export type { Journal };       // §5 — NOT a placeholder; the one definition, re-exported
export interface Capabilities {
  execute(task: Task): Promise<TaskResult>;
  fanOut(tasks: Task[]): Promise<Summary[]>;
  ask(decision: Decision): Promise<Choice>;
  onTrigger(spec: TriggerSpec, handler: (e: TriggerEvent) => Promise<void>): Unsubscribe;
  runProcedure(name: string, args?: unknown): Promise<TaskResult>;
  journal: Journal;
}

// ── runtime guards (so the house rules are testable without a type system at runtime) ──
export const TRIGGER_KINDS = ['manual', 'commit', 'merge', 'ci', 'schedule'] as const;
export function isRecommendedWellFormed(decision: { options: DecisionOption[] }): boolean {
  return decision.options.filter((o) => o.recommended === true).length === 1;
}
