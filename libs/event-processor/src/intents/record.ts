import type { RecordIntent, KeyOverrides } from '../types/write-intent';
import type { HandlerFn, EventPayload } from '../types/handler-config';
import type { EventContext } from '../types/event-context';
import type { RejectNonAppend } from '../types/ownership';

/**
 * @remarks Ownership enforcement requires a string-literal `typename`; a widened `string` bypasses it. See types/ownership.ts.
 */
export function record<K extends string>(typename: RejectNonAppend<K>, fieldsOrMapper: Record<string, unknown>, overrides?: KeyOverrides): RecordIntent;
export function record<K extends string>(typename: RejectNonAppend<K>, fieldsOrMapper: (payload: EventPayload, ctx: EventContext) => Record<string, unknown>, overrides?: KeyOverrides): HandlerFn;
export function record<K extends string>(
  typename: RejectNonAppend<K>,
  fieldsOrMapper: Record<string, unknown> | ((payload: EventPayload, ctx: EventContext) => Record<string, unknown>),
  overrides?: KeyOverrides,
): RecordIntent | HandlerFn {
  const name = typename as string;
  if (typeof fieldsOrMapper === 'function') {
    return (payload: EventPayload, ctx: EventContext) => ({
      _tag: 'record' as const,
      typename: name,
      fields: fieldsOrMapper(payload, ctx),
      overrides,
    });
  }
  return { _tag: 'record', typename: name, fields: fieldsOrMapper, overrides };
}
