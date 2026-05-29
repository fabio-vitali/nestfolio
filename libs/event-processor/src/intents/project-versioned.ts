import type { ProjectVersionedIntent, KeyOverrides } from '../types/write-intent';
import type { HandlerFn, EventPayload } from '../types/handler-config';
import type { EventContext } from '../types/event-context';
import type { RejectNonP1 } from '../types/ownership';

type VersionResolver = number | ((payload: EventPayload, ctx: EventContext) => number);

/**
 * P1 versioned-snapshot projection. Writes the FULL row guarded by
 * `attribute_not_exists(pk) OR #__version < :version`; a stale/duplicate
 * version is dropped (deduplicated), NOT redriven. `version` is required.
 */
export function projectVersioned<K extends string>(
  typename: RejectNonP1<K>,
  fields: Record<string, unknown>,
  opts: { version: number; overrides?: KeyOverrides },
): ProjectVersionedIntent;
export function projectVersioned<K extends string>(
  typename: RejectNonP1<K>,
  fieldsMapper: (payload: EventPayload, ctx: EventContext) => Record<string, unknown>,
  opts: { version: VersionResolver; overrides?: KeyOverrides },
): HandlerFn;
export function projectVersioned<K extends string>(
  typename: RejectNonP1<K>,
  fieldsOrMapper:
    | Record<string, unknown>
    | ((payload: EventPayload, ctx: EventContext) => Record<string, unknown>),
  opts: { version: VersionResolver; overrides?: KeyOverrides },
): ProjectVersionedIntent | HandlerFn {
  const name = typename as string;
  if (typeof fieldsOrMapper === 'function') {
    return (payload: EventPayload, ctx: EventContext) => ({
      _tag: 'projectVersioned' as const,
      typename: name,
      fields: fieldsOrMapper(payload, ctx),
      version: typeof opts.version === 'function' ? opts.version(payload, ctx) : opts.version,
      ...(opts.overrides ? { overrides: opts.overrides } : {}),
    });
  }
  return {
    _tag: 'projectVersioned',
    typename: name,
    fields: fieldsOrMapper,
    version: opts.version as number,
    // Intentional divergence from record.ts/project.ts: the `overrides` key is
    // OMITTED (not set to `undefined`) when none are passed. Safe downstream
    // because the executor reads `intent.overrides?.pk` (optional chaining) and
    // `stripUndefinedDeep` strips undefined leaves — so an absent key and an
    // `undefined` value behave identically.
    ...(opts.overrides ? { overrides: opts.overrides } : {}),
  };
}
