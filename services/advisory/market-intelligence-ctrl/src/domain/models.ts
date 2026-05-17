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
  pk: string;                              // `MarketSnapshot#${region}`
  sk: 'MarketSnapshot';
  __typename: 'MarketSnapshot';
  region: string;
  agentOutput: {
    signals: Array<{
      type: string;
      ticker: string;
      sentiment: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
      confidence: number;
      source: string;
    }>;
    tickersMentioned: string[];
    marketOutlook: string;
    confidenceScore: number;
  };
  fastComponentsAt: string;
  slowComponentsAt: string;
  sourceEventIds: string[];                // ring buffer, last 20
  updatedAt: string;
}
