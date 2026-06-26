import {
  MarketSnapshotSchema,
  MarketSnapshotRefreshTickSchema,
} from '../../../src/domain/contracts';

const validSignal = {
  type: 'momentum',
  ticker: 'VTI',
  sentiment: 'BULLISH' as const,
  confidence: 0.82,
  source: 'yahoo-finance',
};

const validAgentOutput = {
  signals: [validSignal],
  tickersMentioned: ['VTI', 'SPY'],
  marketOutlook: 'Cautiously optimistic given current macro conditions',
  confidenceScore: 0.75,
};

describe('market-intelligence-ctrl contracts', () => {
  it('MarketSnapshotSchema is dry — region is NOT on the subject (it travels in RegionContext)', () => {
    const parsed = MarketSnapshotSchema.parse({
      region: 'us-east-1', // extra key — must be stripped, not required
      agentOutput: { signals: [], tickersMentioned: [], marketOutlook: 'neutral', confidenceScore: 0.5 },
      __version: 1,
    });
    expect('region' in parsed).toBe(false);
    expect(parsed.agentOutput.marketOutlook).toBe('neutral');
  });

  it('MarketSnapshotRefreshTickSchema is fully dry — region travels in RegionContext, not the subject', () => {
    const parsed = MarketSnapshotRefreshTickSchema.parse({
      region: 'us-east-1', // extra key — stripped; region is identity (RegionContext)
    });
    expect('region' in parsed).toBe(false);
  });

  it('MarketSnapshotSchema still requires agentOutput', () => {
    expect(() => MarketSnapshotSchema.parse({ __version: 1 })).toThrow();
  });

  it('__version is optional', () => {
    const subject = { agentOutput: validAgentOutput };
    const parsed = MarketSnapshotSchema.parse(subject);
    expect(parsed.__version).toBeUndefined();
  });

  it('signal sentiment must be BULLISH | BEARISH | NEUTRAL', () => {
    const invalidSubject = {
      agentOutput: {
        ...validAgentOutput,
        signals: [{ ...validSignal, sentiment: 'VERY_BULLISH' }],
      },
    };
    expect(() => MarketSnapshotSchema.parse(invalidSubject)).toThrow();
  });

  it('agentOutput shape is verified — missing signals throws', () => {
    const { signals: _omitted, ...withoutSignals } = validAgentOutput;
    expect(() =>
      MarketSnapshotSchema.parse({ agentOutput: withoutSignals }),
    ).toThrow();
  });

  it('agentOutput shape is verified — missing confidenceScore throws', () => {
    const { confidenceScore: _omitted, ...withoutScore } = validAgentOutput;
    expect(() =>
      MarketSnapshotSchema.parse({ agentOutput: withoutScore }),
    ).toThrow();
  });
});
