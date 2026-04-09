declare const __brand: unique symbol;

/** Branded event name type. Only constructable via eventName(). */
export type EventName = string & { readonly [__brand]: 'EventName' };

/**
 * Create a typed event name constant.
 * Preserves the literal type for autocomplete and refactoring.
 */
export function eventName<T extends string>(name: T): EventName & T {
  return name as EventName & T;
}

/**
 * Runtime assertion for the JSON serialization boundary.
 * Use in CDC pipeline after deserializing EVENT_TYPE_MAP.
 * Throws if the resolved name is falsy (unmapped record).
 */
export function assertEventName(
  resolved: string | null | undefined,
  context: string,
): EventName {
  if (!resolved) {
    throw new Error(`Event name resolution failed: ${context}`);
  }
  return resolved as EventName;
}
