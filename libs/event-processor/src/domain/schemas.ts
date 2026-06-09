import { z } from 'zod';
import { type TenantId, type UserId, asTenantId, asUserId } from '../platform/types/branded';

/**
 * Base for all event/row context types — the constraint base for `BusEvent<T, S>`
 * and `TableEntry<T, S>`. Global aggregates (no identity scope) use it directly,
 * or equivalently `Record<string, never>`. Named `SubjectContext` (not `EventContext`,
 * which is the per-invocation handler context). See the typed-subject-producer-contracts
 * design spec § "The one shared-library change".
 */
export type SubjectContext = object;

/** Region-scoped aggregates (e.g. market data keyed on region; no tenant identity). */
export interface RegionContext extends SubjectContext {
  region: string;
}

export const RequestContextSchema = z.object({
  tenantId: z.string().uuid(),
  userId: z.string().uuid(),
  region: z.string(),
});

export type RequestContext = {
  tenantId: TenantId;
  userId: UserId;
  region: string;
};

/**
 * Parses and validates raw input against RequestContextSchema,
 * then returns branded RequestContext.
 */
/**
 * Narrows any object that extends RequestContext back to just the context fields.
 * Driven by RequestContextSchema keys — adding a field to the schema propagates here.
 */
export function pickRequestContext<T extends RequestContext>(ctx: T): RequestContext {
  const { tenantId, userId, region } = ctx;
  return { tenantId, userId, region };
}

export function parseRequestContext(raw: unknown): RequestContext {
  const parsed = RequestContextSchema.parse(raw);
  return {
    tenantId: asTenantId(parsed.tenantId),
    userId: asUserId(parsed.userId),
    region: parsed.region,
  };
}

export const BusEventSchema = z.object({
  id: z.string().uuid(),
  type: z.string().min(1),
  timestamp: z.string().datetime(),
  subject: z.record(z.unknown()),
  context: RequestContextSchema,
});

export type BusEventPayload = z.infer<typeof BusEventSchema>;
