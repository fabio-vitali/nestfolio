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
 * MARKET_SNAPSHOT_REFRESH_TICK — self-tick from scheduled-emitter.ts; drives the slow-tier rebuild.
 * Fully DRY subject — `region` is identity and travels in the RegionContext (the event context),
 * NOT on the subject (matches MarketSnapshotSchema's subject->context migration). The slow-tier
 * handler reads region from `ctx.region`.
 * Confirmed against scheduled-emitter.ts createScheduledEmitter: `subject: {}`.
 */
export const MarketSnapshotRefreshTickSchema = z.object({});
export type MarketSnapshotRefreshTick = z.infer<typeof MarketSnapshotRefreshTickSchema>;

/**
 * Test-fixture event→subject map for market-intelligence-ctrl's emissions. Co-located with the
 * producer-owned schemas (single source of truth); consumed only by `@nestfolio/test-contracts`.
 * Bare string-literal keys so `keyof typeof` is a literal union.
 */
export const marketIntelligenceCtrlEventSubjects = {
  MARKET_SNAPSHOT_REFRESH_TICK: MarketSnapshotRefreshTickSchema,
  MARKET_SNAPSHOT_UPDATED: MarketSnapshotSchema,
} as const satisfies Record<string, ZodTypeAny>;
