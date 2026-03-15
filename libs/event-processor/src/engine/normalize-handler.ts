import type { WriteIntent } from '../types/write-intent';
import type { HandlerEntry, HandlerFn, EventPayload } from '../types/handler-config';
import type { EventContext } from '../types/event-context';

type NormalizedHandler = (payload: EventPayload, ctx: EventContext) => Promise<WriteIntent[]>;

function isWriteIntent(value: unknown): value is WriteIntent {
  return typeof value === 'object' && value !== null && '_tag' in value;
}

function toArray(result: WriteIntent | WriteIntent[]): WriteIntent[] {
  return Array.isArray(result) ? result : [result];
}

export function normalizeHandler(entry: HandlerEntry): NormalizedHandler {
  // Array of HandlerFn | WriteIntent
  if (Array.isArray(entry)) {
    return async (payload, ctx) => {
      const intents: WriteIntent[] = [];
      for (const item of entry) {
        if (typeof item === 'function') {
          const result = await item(payload, ctx);
          intents.push(...toArray(result));
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
    return toArray(result);
  };
}
