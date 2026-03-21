import { type ZodType } from 'zod';
import { type Result, ok, err } from '../platform';

export type Patches = ReadonlyArray<{
  readonly op: 'add' | 'replace' | 'remove';
  readonly path: string;
  readonly value?: unknown;
}>;

export interface CommandDef<P, S> {
  readonly type: string;
  readonly schema: ZodType<P>;
  readonly apply: (state: S, payload: P) => S;
}

export function defineCommand<P, S>(def: CommandDef<P, S>): CommandDef<P, S> {
  return Object.freeze(def);
}

export type CommandError =
  | { readonly type: 'validation'; readonly message: string; readonly issues: unknown[] }
  | { readonly type: 'invariant'; readonly message: string };

export function applyCommand<P, S>(
  command: CommandDef<P, S>,
  payload: unknown,
  state: S,
): Result<{ nextState: S; payload: P }, CommandError> {
  const parsed = command.schema.safeParse(payload);
  if (!parsed.success) {
    return err({
      type: 'validation',
      message: parsed.error.message,
      issues: parsed.error.issues,
    });
  }
  try {
    const nextState = command.apply(state, parsed.data);
    return ok({ nextState, payload: parsed.data });
  } catch (e) {
    return err({
      type: 'invariant',
      message: e instanceof Error ? e.message : String(e),
    });
  }
}
