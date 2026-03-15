import type { RecordIntent, KeyOverrides } from '../types/write-intent';
import type { HandlerFn, EventPayload } from '../types/handler-config';
import type { EventContext } from '../types/event-context';

export function record(typename: string, fieldsOrMapper: Record<string, unknown>, overrides?: KeyOverrides): RecordIntent;
export function record(typename: string, fieldsOrMapper: (payload: EventPayload, ctx: EventContext) => Record<string, unknown>, overrides?: KeyOverrides): HandlerFn;
export function record(
  typename: string,
  fieldsOrMapper: Record<string, unknown> | ((payload: EventPayload, ctx: EventContext) => Record<string, unknown>),
  overrides?: KeyOverrides,
): RecordIntent | HandlerFn {
  if (typeof fieldsOrMapper === 'function') {
    return (payload: EventPayload, ctx: EventContext) => ({
      _tag: 'record' as const,
      typename,
      fields: fieldsOrMapper(payload, ctx),
      overrides,
    });
  }
  return { _tag: 'record', typename, fields: fieldsOrMapper, overrides };
}
