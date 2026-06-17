// Producer-owned event/row subject contracts for market-intelligence-ctrl. Imports ONLY zod.
import { z } from 'zod';
import type { ZodTypeAny } from 'zod';
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

/**
 * Test-fixture event→subject map for market-intelligence-ctrl's emissions. Co-located with the
 * producer-owned schemas (single source of truth); consumed only by `@nestfolio/test-contracts`.
 * Bare string-literal keys so `keyof typeof` is a literal union.
 * Note: MARKET_SNAPSHOT_REFRESH_TICK added in Task 5 (schema to be authored there).
 */
export const marketIntelligenceCtrlEventSubjects = {
  MARKET_SNAPSHOT_UPDATED: MarketSnapshotSchema,
} as const satisfies Record<string, ZodTypeAny>;
