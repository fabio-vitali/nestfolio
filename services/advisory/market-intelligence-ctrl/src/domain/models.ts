import type { TableEntry, RegionContext } from '@nestfolio/event-processor';
import type { MarketSnapshot } from './contracts';

export interface MarketSignal {
  readonly type: string;
  readonly ticker: string;
  readonly sentiment: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  readonly confidence: number;
  readonly source: string;
}

export interface MarketAnalysisResult {
  readonly signals: ReadonlyArray<MarketSignal>;
  readonly tickersMentioned: ReadonlyArray<string>;
  readonly marketOutlook: string;
  readonly confidenceScore: number;
  readonly metadata: { readonly durationMs: number; readonly modelTier: string };
}

export interface AgentInvocation {
  readonly invocationId: string;
  readonly decisionId: string;
  readonly tenantId: string;
  readonly agentName: 'market-research';
  readonly status: 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';
  readonly startedAt: string;
  readonly completedAt: string | null;
  readonly durationMs: number | null;
}

export interface ReasoningOutput {
  readonly invocationId: string;
  readonly decisionId: string;
  readonly tenantId: string;
  readonly agentName: string;
  readonly reasoning: string;
  readonly confidence: number;
  readonly createdAt: string;
}

/** Persisted MarketSnapshot row. Region-scoped (RegionContext supplies `region`; no tenant). The
 * row-only operational fields are projection metadata, not part of the emitted business subject. */
export type MarketSnapshotRow = TableEntry<MarketSnapshot, RegionContext> & {
  readonly __typename: 'MarketSnapshot';
  readonly sk: 'MarketSnapshot';
  readonly fastComponentsAt: string;
  /** Set only on slow-tier (tick) rebuilds; absent on fast-tier (feed) snapshots. */
  readonly slowComponentsAt?: string;
  readonly sourceEventIds: ReadonlyArray<string>;
};
