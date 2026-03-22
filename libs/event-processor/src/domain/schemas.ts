import { z } from 'zod';

export const TenantContextSchema = z.object({
  tenantId: z.string().uuid(),
});

export type TenantContext = z.infer<typeof TenantContextSchema>;

export const BusEventSchema = z.object({
  id: z.string().uuid(),
  type: z.string().min(1),
  timestamp: z.string().datetime(),
  subject: z.record(z.unknown()),
  context: TenantContextSchema,
});

export type BusEvent = z.infer<typeof BusEventSchema>;
