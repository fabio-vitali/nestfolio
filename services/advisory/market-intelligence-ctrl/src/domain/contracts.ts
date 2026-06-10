// Producer-owned event/row subject contracts for market-intelligence-ctrl. Imports ONLY zod.
import { z } from 'zod';
import { MarketAnalysisOutputSchema } from '../agents/schemas';

/**
 * MarketSnapshot subject — the `MarketSnapshot` row (sk='MarketSnapshot', pk=`MarketSnapshot#${region}`)
 * CDC-emitted as MARKET_SNAPSHOT_UPDATED. Region-scoped: `region` travels in RegionContext (the
 * event context), NOT on the subject. The persisted row physically carries `region` (it's part of
 * the RegionContext that intersects onto the row), so the CDC publisher derives `context.region`
 * from the row's `region` attribute.
 */
export const MarketSnapshotSchema = z.object({
  agentOutput: MarketAnalysisOutputSchema,
  __version: z.number().optional(),
});

export type MarketSnapshot = z.infer<typeof MarketSnapshotSchema>;
