import type { WriteIntent } from '../types/write-intent';
import type { HandlerEntry, EventPayload } from '../types/handler-config';
import type { EventContext } from '../types/event-context';

type NormalizedHandler = (payload: EventPayload, ctx: EventContext) => Promise<WriteIntent[]>;

function isWriteIntent(value: unknown): value is WriteIntent {
  return typeof value === 'object' && value !== null && '_tag' in value;
}

/**
 * Normalizes a HandlerFn result to a WriteIntent[], dropping anything that is not
 * a WriteIntent. A transform that returns `undefined` (the documented "drop, don't
 * write" path) must yield zero intents — never a `[undefined]` that throws
 * downstream in the ingestion engine's `intents.map(i => i._tag)`.
 */
function toIntents(result: WriteIntent | WriteIntent[]): WriteIntent[] {
  return (Array.isArray(result) ? result : [result]).filter(isWriteIntent);
}

export function normalizeHandler(entry: HandlerEntry): NormalizedHandler {
  // Array of HandlerFn | WriteIntent
  if (Array.isArray(entry)) {
    return async (payload, ctx) => {
      const intents: WriteIntent[] = [];
      for (const item of entry) {
        if (typeof item === 'function') {
          const result = await item(payload, ctx);
          intents.push(...toIntents(result));
        } else if (isWriteIntent(item)) {
          intents.push(item);
        }
      }
      return intents;
    };
  }

  // Single HandlerFn
  return async (payload, ctx) => {
    const result = await entry(payload, ctx);
    return toIntents(result);
  };
}
