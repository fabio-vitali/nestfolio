import { createHandlers } from '../../src/handlers/snapshot-projector';
import {
  PROJECTED_IP_SNAPSHOT_SK,
  PROJECTED_MARKET_SNAPSHOT_SK,
  PROJECTED_LEDGER_SNAPSHOT_SK,
  projectedIpSnapshotPk,
  projectedMarketSnapshotPk,
  projectedLedgerSnapshotPk,
} from '../../src/repositories/projected-snapshot.repository';
import type { EventContext, EventPayload } from '@nestfolio/event-processor';
import { LedgerCtrlEventTypes } from '@nestfolio/ledger-ctrl/events';

// Identity now travels in the event context (RequestContext), not the dry subject.
// overrides is loosely typed so fixtures can vary plain-string test identities
// (tenantId/userId are branded TenantId/UserId on EventContext).
const ctx = (eventType: string, overrides: Record<string, unknown> = {}): EventContext => ({
  eventId: 'evt-1', eventType, tenantId: 'tenant-1', userId: 'user-1', region: 'us-east-1',
  ...overrides,
} as EventContext);

const payload = (subject: Record<string, unknown>): EventPayload => ({
  subject,
  context: { tenantId: 'tenant-1', userId: 'user-1', region: 'us-east-1' },
} as EventPayload);

/** Minimal valid InvestorProfileSnapshot agentOutput matching the schema */
const validIpAgentOutput = {
  goals: ['retire at 60'],
  timeHorizon: '20 years',
  riskWillingness: 'high',
  riskScore: 70,
  riskCategory: 'AGGRESSIVE' as const,
  regulatoryFlags: [],
  suitabilityAssessment: 'suitable',
  confidence: 0.9,
};

/** Minimal valid MarketSnapshot agentOutput matching MarketAnalysisOutputSchema */
const validMarketAgentOutput = {
  signals: [
    { type: 'momentum', ticker: 'VTI', sentiment: 'BULLISH' as const, confidence: 0.8, source: 'yahoo' },
  ],
  tickersMentioned: ['VTI'],
  marketOutlook: 'Cautiously optimistic',
  confidenceScore: 0.75,
};

describe('snapshot-projector', () => {
  const handlers = createHandlers();

  it('INVESTOR_PROFILE_SNAPSHOT_CREATED → projectVersioned keyed on subject.__version', async () => {
    const result = await handlers.INVESTOR_PROFILE_SNAPSHOT_CREATED(
      // Dry subject — identity (tenant-1/user-1) is supplied by the event context.
      payload({
        agentOutput: validIpAgentOutput,
        sourceEventId: 'src-e1',
        __version: 1,
      }),
      ctx('INVESTOR_PROFILE_SNAPSHOT_CREATED'),
    );
    const intent = Array.isArray(result) ? result[0] : result;
    expect(intent!._tag).toBe('projectVersioned');
    expect(intent!.typename).toBe('InvestorProfileSnapshot');
    expect((intent as { version: number }).version).toBe(1);
    expect((intent as { overrides?: { pk?: string; sk?: string } }).overrides?.pk).toBe(
      projectedIpSnapshotPk('tenant-1', 'user-1'),
    );
    expect((intent as { overrides?: { pk?: string; sk?: string } }).overrides?.sk).toBe(PROJECTED_IP_SNAPSHOT_SK);
    const fields = (intent as { fields: Record<string, unknown> }).fields;
    expect(fields.tenantId).toBe('tenant-1');
    expect(fields.userId).toBe('user-1');
    expect(JSON.parse(fields.agentOutput as string)).toMatchObject({ riskScore: 70, riskCategory: 'AGGRESSIVE' });
    expect(fields.sourceEventId).toBe('src-e1');
    expect(typeof fields.updatedAt).toBe('string');
  });

  it('INVESTOR_PROFILE_SNAPSHOT_UPDATED → projectVersioned with the incremented version', async () => {
    const result = await handlers.INVESTOR_PROFILE_SNAPSHOT_UPDATED(
      // Dry subject — identity is supplied by the event context.
      payload({
        agentOutput: { ...validIpAgentOutput, riskScore: 55, riskCategory: 'MODERATE' },
        sourceEventId: 'src-e2',
        __version: 4,
      }),
      ctx('INVESTOR_PROFILE_SNAPSHOT_UPDATED'),
    );
    const intent = Array.isArray(result) ? result[0] : result;
    expect(intent!._tag).toBe('projectVersioned');
    expect(intent!.typename).toBe('InvestorProfileSnapshot');
    expect((intent as { version: number }).version).toBe(4);
    const fields = (intent as { fields: Record<string, unknown> }).fields;
    expect(JSON.parse(fields.agentOutput as string)).toMatchObject({ riskScore: 55 });
    expect(fields.sourceEventId).toBe('src-e2');
  });

  it('IP snapshot drops (undefined) when __version is absent', async () => {
    const result = await handlers.INVESTOR_PROFILE_SNAPSHOT_UPDATED(
      payload({ agentOutput: validIpAgentOutput }),
      ctx('INVESTOR_PROFILE_SNAPSHOT_UPDATED'),
    );
    expect(result).toBeUndefined();
  });

  it('INVESTOR_PROFILE_SNAPSHOT_CREATED falls back to ctx.eventId when sourceEventId missing', async () => {
    const result = await handlers.INVESTOR_PROFILE_SNAPSHOT_CREATED(
      payload({
        agentOutput: validIpAgentOutput,
        __version: 1,
      }),
      ctx('INVESTOR_PROFILE_SNAPSHOT_CREATED', { eventId: 'fallback-evt' }),
    );
    const intent = Array.isArray(result) ? result[0] : result;
    expect((intent as { fields: Record<string, unknown> }).fields.sourceEventId).toBe('fallback-evt');
  });

  it('IP snapshot handlers throw on invalid agentOutput shape (schema enforcement)', async () => {
    // An agentOutput missing required fields (e.g. riskCategory) should throw ZodError
    await expect(
      handlers.INVESTOR_PROFILE_SNAPSHOT_CREATED(
        payload({
          agentOutput: { riskScore: 70 },   // missing riskCategory, goals, etc.
          __version: 1,
        }),
        ctx('INVESTOR_PROFILE_SNAPSHOT_CREATED'),
      ),
    ).rejects.toThrow();
  });

  it('IP snapshot sources tenantId/userId from the event context, not the dry subject', async () => {
    // The dry InvestorProfileSnapshotSchema no longer carries tenantId/userId —
    // identity travels in the event context (RequestContext). A subject carrying
    // no identity still projects, deriving identity from ctx.
    const result = await handlers.INVESTOR_PROFILE_SNAPSHOT_CREATED(
      payload({ agentOutput: validIpAgentOutput, __version: 1 }),
      ctx('INVESTOR_PROFILE_SNAPSHOT_CREATED', { tenantId: 'ctx-tenant', userId: 'ctx-user' }),
    );
    const intent = Array.isArray(result) ? result[0] : result;
    const fields = (intent as { fields: Record<string, unknown> }).fields;
    expect(fields.tenantId).toBe('ctx-tenant');
    expect(fields.userId).toBe('ctx-user');
    expect((intent as { overrides?: { pk?: string } }).overrides?.pk).toBe(
      projectedIpSnapshotPk('ctx-tenant', 'ctx-user'),
    );
  });

  it('MARKET_SNAPSHOT_UPDATED → projectVersioned keyed on subject.__version', async () => {
    const result = await handlers.MARKET_SNAPSHOT_UPDATED(
      payload({
        region: 'us-east-1',
        agentOutput: validMarketAgentOutput,
        __version: 9,
      }),
      ctx('MARKET_SNAPSHOT_UPDATED', { tenantId: 'SYSTEM' }),
    );
    const intent = Array.isArray(result) ? result[0] : result;
    expect(intent!._tag).toBe('projectVersioned');
    expect(intent!.typename).toBe('MarketSnapshot');
    expect((intent as { version: number }).version).toBe(9);
    expect((intent as { overrides?: { pk?: string; sk?: string } }).overrides?.pk).toBe(
      projectedMarketSnapshotPk('us-east-1'),
    );
    expect((intent as { overrides?: { pk?: string; sk?: string } }).overrides?.sk).toBe(PROJECTED_MARKET_SNAPSHOT_SK);
    const fields = (intent as { fields: Record<string, unknown> }).fields;
    expect(fields.region).toBe('us-east-1');
    expect(JSON.parse(fields.agentOutput as string)).toMatchObject({ confidenceScore: 0.75 });
    expect(typeof fields.updatedAt).toBe('string');
    expect(fields.pk).toBeUndefined();
    expect(fields.sk).toBeUndefined();
  });

  it('MARKET_SNAPSHOT_UPDATED drops (undefined) when __version is absent', async () => {
    const result = await handlers.MARKET_SNAPSHOT_UPDATED(
      payload({ region: 'us-east-1', agentOutput: validMarketAgentOutput }),
      ctx('MARKET_SNAPSHOT_UPDATED', { tenantId: 'SYSTEM' }),
    );
    expect(result).toBeUndefined();
  });

  it('MARKET_SNAPSHOT_UPDATED throws on invalid agentOutput shape (schema enforcement)', async () => {
    // agentOutput missing required fields (e.g. signals) should throw ZodError
    await expect(
      handlers.MARKET_SNAPSHOT_UPDATED(
        payload({ region: 'us-east-1', agentOutput: { outlook: 'bullish' }, __version: 1 }),
        ctx('MARKET_SNAPSHOT_UPDATED', { tenantId: 'SYSTEM' }),
      ),
    ).rejects.toThrow();
  });

  it('MARKET_SNAPSHOT_UPDATED throws on missing subject.region (schema enforcement)', async () => {
    // subject missing region should throw ZodError
    await expect(
      handlers.MARKET_SNAPSHOT_UPDATED(
        payload({ agentOutput: validMarketAgentOutput, __version: 1 }),
        ctx('MARKET_SNAPSHOT_UPDATED', { tenantId: 'SYSTEM' }),
      ),
    ).rejects.toThrow();
  });
});

describe('snapshot-projector — LedgerSnapshot', () => {
  const handlers = createHandlers();

  it('projects PORTFOLIO_UPDATED into a LedgerSnapshot projectVersioned keyed on lastEventSequence', async () => {
    const result = await handlers[LedgerCtrlEventTypes.PORTFOLIO_UPDATED](
      // Dry PORTFOLIO_UPDATED subject — tenantId is supplied by the event context.
      payload({
        positions: { VTI: { symbol: 'VTI', quantity: 10, averageCostBasis: 200, totalCostBasis: 2000, lastFillPrice: 200 } },
        snapshot: {
          positions: { VTI: { symbol: 'VTI', quantity: 10, averageCostBasis: 200, totalCostBasis: 2000, lastFillPrice: 200 } },
          cashBalanceCents: 5_000_00,
          lastEventSequence: 7,
        },
      }),
      ctx('PORTFOLIO_UPDATED', { tenantId: 'tenant-abc', eventId: 'evt-1' }),
    );
    const intent = Array.isArray(result) ? result[0] : result;
    expect(intent!._tag).toBe('projectVersioned');
    expect(intent!.typename).toBe('LedgerSnapshot');
    expect((intent as { version: number }).version).toBe(7);
    expect((intent as { overrides?: { pk?: string; sk?: string } }).overrides?.pk).toBe(
      projectedLedgerSnapshotPk('tenant-abc'),
    );
    expect((intent as { overrides?: { pk?: string; sk?: string } }).overrides?.sk).toBe(PROJECTED_LEDGER_SNAPSHOT_SK);
    const fields = (intent as { fields: Record<string, unknown> }).fields;
    expect(fields.tenantId).toBe('tenant-abc');
    expect(fields.lastEventSequence).toBe(7);
    const parsed = JSON.parse(fields.state as string);
    expect(parsed.positions.VTI.quantity).toBe(10);
    expect(parsed.cashBalanceCents).toBe(500_000);
    // DRIFT: PORTFOLIO_UPDATED subjects don't carry sourceEventId — ctx.eventId is used directly
    expect(fields.sourceEventId).toBe('evt-1');
    expect(typeof fields.updatedAt).toBe('string');
  });

  it('LedgerSnapshot throws ZodError when snapshot.lastEventSequence is absent (schema enforcement)', async () => {
    // PortfolioUpdatedSchema → LedgerSnapshotSchema requires lastEventSequence: z.number().
    // A subject missing it is a producer contract violation caught at parse time (ZodError),
    // routed to the event-processor DLQ/poison-pill path.
    await expect(
      handlers[LedgerCtrlEventTypes.PORTFOLIO_UPDATED](
        payload({
          positions: {},
          snapshot: { positions: {}, cashBalanceCents: 0 }, // missing lastEventSequence
        }),
        ctx('PORTFOLIO_UPDATED', { tenantId: 'tenant-abc', eventId: 'evt-3' }),
      ),
    ).rejects.toThrow();
  });

  it('raises NotRetryableError when subject.snapshot is missing', async () => {
    await expect(
      handlers[LedgerCtrlEventTypes.PORTFOLIO_UPDATED](
        payload({ positions: {} }),
        ctx('PORTFOLIO_UPDATED', { tenantId: 'tenant-abc', eventId: 'evt-2' }),
      ),
    ).rejects.toThrow();
  });
});
