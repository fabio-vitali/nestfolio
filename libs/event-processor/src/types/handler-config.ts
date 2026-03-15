import type { EventContext } from './event-context';
import type { WriteIntent } from './write-intent';

export interface EventPayload {
  readonly subject: Record<string, unknown>;
  readonly context?: Record<string, unknown>;
}

export type HandlerFn = (
  payload: EventPayload,
  ctx: EventContext,
) => WriteIntent | WriteIntent[] | Promise<WriteIntent | WriteIntent[]>;

/**
 * A handler entry is either:
 * - A single HandlerFn (most common)
 * - An array of HandlerFn | WriteIntent (multi-write, results merged)
 */
export type HandlerEntry = HandlerFn | Array<HandlerFn | WriteIntent>;
