// Producer-owned event payload contracts for market-intelligence-ctrl. Imports ONLY zod.
import { z } from 'zod';
import { MarketAnalysisOutputSchema } from '../agents/schemas';

/**
 * Subject carried on MARKET_SNAPSHOT_UPDATED.
 * The CDC pipeline publishes the full MarketSnapshot DDB row as the subject.
 * Shape is verified against MarketSnapshotRow in domain/models.ts and the
 * update() intent in handlers/event-listener.ts (region, agentOutput).
 * MarketAnalysisOutputSchema is reused from agents/schemas.ts (zod-only, no side effects).
 */
export const MarketSnapshotSchema = z.object({
  region: z.string(),
  agentOutput: MarketAnalysisOutputSchema,
  __version: z.number().optional(),
});

export type MarketSnapshot = z.infer<typeof MarketSnapshotSchema>;
