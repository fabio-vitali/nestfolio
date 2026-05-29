import type { ProjectIntent, KeyOverrides } from '../types/write-intent';
import type { HandlerFn, EventPayload } from '../types/handler-config';
import type { EventContext } from '../types/event-context';
import type { RejectProjection } from '../types/ownership';

/**
 * @remarks Ownership enforcement requires a string-literal `typename`; a widened `string` bypasses it. See types/ownership.ts.
 */
export function project<K extends string>(typename: RejectProjection<K>, fieldsOrMapper: Record<string, unknown>, overrides?: KeyOverrides): ProjectIntent;
export function project<K extends string>(typename: RejectProjection<K>, fieldsOrMapper: (payload: EventPayload, ctx: EventContext) => Record<string, unknown>, overrides?: KeyOverrides): HandlerFn;
export function project<K extends string>(
  typename: RejectProjection<K>,
  fieldsOrMapper: Record<string, unknown> | ((payload: EventPayload, ctx: EventContext) => Record<string, unknown>),
  overrides?: KeyOverrides,
): ProjectIntent | HandlerFn {
  const name = typename as string;
  if (typeof fieldsOrMapper === 'function') {
    return (payload: EventPayload, ctx: EventContext) => ({
      _tag: 'project' as const,
      typename: name,
      fields: fieldsOrMapper(payload, ctx),
      overrides,
    });
  }
  return { _tag: 'project', typename: name, fields: fieldsOrMapper, overrides };
}
