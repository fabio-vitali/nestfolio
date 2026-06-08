import {
  MarketSnapshotSchema,
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
  it('MarketSnapshotSchema parses a full CDC snapshot subject', () => {
    const subject = {
      region: 'us-east-1',
      agentOutput: validAgentOutput,
      __version: 9,
    };
    const parsed = MarketSnapshotSchema.parse(subject);
    expect(parsed.region).toBe('us-east-1');
    expect(parsed.agentOutput.confidenceScore).toBe(0.75);
    expect(parsed.agentOutput.signals[0].sentiment).toBe('BULLISH');
    expect(parsed.__version).toBe(9);
  });

  it('__version is optional', () => {
    const subject = { region: 'us-east-1', agentOutput: validAgentOutput };
    const parsed = MarketSnapshotSchema.parse(subject);
    expect(parsed.__version).toBeUndefined();
  });

  it('requires region', () => {
    expect(() =>
      MarketSnapshotSchema.parse({ agentOutput: validAgentOutput }),
    ).toThrow();
  });

  it('signal sentiment must be BULLISH | BEARISH | NEUTRAL', () => {
    const invalidSubject = {
      region: 'us-east-1',
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
      MarketSnapshotSchema.parse({ region: 'us-east-1', agentOutput: withoutSignals }),
    ).toThrow();
  });

  it('agentOutput shape is verified — missing confidenceScore throws', () => {
    const { confidenceScore: _omitted, ...withoutScore } = validAgentOutput;
    expect(() =>
      MarketSnapshotSchema.parse({ region: 'us-east-1', agentOutput: withoutScore }),
    ).toThrow();
  });
});
