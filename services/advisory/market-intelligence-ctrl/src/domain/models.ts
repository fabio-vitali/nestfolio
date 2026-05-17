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

export interface MarketSnapshotRow {
  readonly pk: string;                              // `MarketSnapshot#${region}`
  readonly sk: 'MarketSnapshot';
  readonly __typename: 'MarketSnapshot';
  readonly region: string;
  readonly agentOutput: {
    readonly signals: ReadonlyArray<{
      readonly type: string;
      readonly ticker: string;
      readonly sentiment: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
      readonly confidence: number;
      readonly source: string;
    }>;
    readonly tickersMentioned: ReadonlyArray<string>;
    readonly marketOutlook: string;
    readonly confidenceScore: number;
  };
  readonly fastComponentsAt: string;
  readonly slowComponentsAt: string;
  readonly sourceEventIds: ReadonlyArray<string>;   // ring buffer, last 20
  readonly updatedAt: string;
}
