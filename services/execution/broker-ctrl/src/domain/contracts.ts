import { z } from 'zod';

export const FundingSnapshotSchema = z.object({
  sk: z.string(), // CDC passthrough field — the lifecycle event name (DEPOSIT_SETTLED, etc.)
  direction: z.enum(['DEPOSIT', 'WITHDRAWAL']),
  status: z.enum(['requested', 'detected', 'settled', 'failed']),
  transferId: z.string(),
  tenantId: z.string(),
  userId: z.string(),
  region: z.string(),
  amountCents: z.number(),
  currency: z.string(),
  executionMode: z.enum(['simulation', 'live']),
  initiatedAt: z.string(),
  detectedAt: z.string().optional(),
  settledAt: z.string().optional(),
  failedAt: z.string().optional(),
  reason: z.string().optional(),
  timestamp: z.string(),
  __version: z.number().optional(), // CDC-added; absent on the carrier row itself
});

export type FundingSnapshot = z.infer<typeof FundingSnapshotSchema>;
