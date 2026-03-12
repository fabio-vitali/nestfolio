import { z } from 'zod';

export const TimestampSchema = z.string().min(1, 'timestamp is required');

export const OrderHistoryArgsSchema = z.object({
  limit: z.number().int().positive().max(100).optional(),
  nextToken: z.string().optional(),
});
