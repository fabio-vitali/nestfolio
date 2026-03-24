import { z } from 'zod';
import { type TenantId, type UserId, asTenantId, asUserId } from '../platform/types/branded';

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
