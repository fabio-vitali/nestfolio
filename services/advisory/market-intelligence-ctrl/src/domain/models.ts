export interface MarketAnalysisInput {
  readonly tenantId: string;
  readonly decisionId: string;
  readonly taskToken: string;
  readonly upstreamOutputs: Record<string, unknown>;
}

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

export interface FeedContent {
  readonly source: string;
  readonly articles: ReadonlyArray<{ title: string; link?: string; pubDate?: string; description?: string }>;
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
