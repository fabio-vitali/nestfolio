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

export const EditOperationSchema = z.enum([
  'add',
  'remove',
  'replace',
  'move',
  'copy',
  'test',
]);

export type EditOperation = z.infer<typeof EditOperationSchema>;

export const EditEventSchema = z.object({
  operation: EditOperationSchema,
  path: z.string(),
  value: z.unknown().optional(),
  previousValue: z.unknown().optional(),
  editedBy: z.string(),
  editedAt: z.string().datetime(),
});

export type EditEvent = z.infer<typeof EditEventSchema>;
