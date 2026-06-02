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

const ctx = (eventType: string, overrides: Partial<EventContext> = {}): EventContext => ({
  eventId: 'evt-1', eventType, tenantId: 'tenant-1', userId: 'user-1', region: 'us-east-1',
  ...overrides,
} as EventContext);

const payload = (subject: Record<string, unknown>): EventPayload => ({
  subject,
  context: { tenantId: 'tenant-1', userId: 'user-1', region: 'us-east-1' },
} as EventPayload);

describe('snapshot-projector', () => {
  const handlers = createHandlers();

  it('INVESTOR_PROFILE_SNAPSHOT_CREATED → projectVersioned keyed on subject.__version', async () => {
    const result = await handlers.INVESTOR_PROFILE_SNAPSHOT_CREATED(
      payload({
        tenantId: 'tenant-1',
        userId: 'user-1',
        agentOutput: { riskScore: 55, riskTolerance: 'MODERATE' },
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
    expect(JSON.parse(fields.agentOutput as string)).toEqual({ riskScore: 55, riskTolerance: 'MODERATE' });
    expect(fields.sourceEventId).toBe('src-e1');
    expect(typeof fields.updatedAt).toBe('string');
  });

  it('INVESTOR_PROFILE_SNAPSHOT_UPDATED → projectVersioned with the incremented version', async () => {
    const result = await handlers.INVESTOR_PROFILE_SNAPSHOT_UPDATED(
      payload({
        tenantId: 'tenant-1',
        userId: 'user-1',
        agentOutput: { riskScore: 70 },
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
    expect(JSON.parse(fields.agentOutput as string)).toEqual({ riskScore: 70 });
    expect(fields.sourceEventId).toBe('src-e2');
  });

  it('IP snapshot drops (undefined) when __version is absent', async () => {
    const result = await handlers.INVESTOR_PROFILE_SNAPSHOT_UPDATED(
      payload({ tenantId: 'tenant-1', userId: 'user-1', agentOutput: { riskScore: 1 } }),
      ctx('INVESTOR_PROFILE_SNAPSHOT_UPDATED'),
    );
    expect(result).toBeUndefined();
  });

  it('INVESTOR_PROFILE_SNAPSHOT_CREATED falls back to ctx.eventId when sourceEventId missing', async () => {
    const result = await handlers.INVESTOR_PROFILE_SNAPSHOT_CREATED(
      payload({
        tenantId: 'tenant-1',
        userId: 'user-1',
        agentOutput: { riskScore: 50 },
        __version: 1,
      }),
      ctx('INVESTOR_PROFILE_SNAPSHOT_CREATED', { eventId: 'fallback-evt' }),
    );
    const intent = Array.isArray(result) ? result[0] : result;
    expect((intent as { fields: Record<string, unknown> }).fields.sourceEventId).toBe('fallback-evt');
  });

  it('IP snapshot handlers throw NotRetryableError when agentOutput missing', async () => {
    await expect(
      handlers.INVESTOR_PROFILE_SNAPSHOT_CREATED(
        payload({ tenantId: 'tenant-1', userId: 'user-1', __version: 1 }),
        ctx('INVESTOR_PROFILE_SNAPSHOT_CREATED'),
      ),
    ).rejects.toThrow(/agentOutput/);
    await expect(
      handlers.INVESTOR_PROFILE_SNAPSHOT_UPDATED(
        payload({ tenantId: 'tenant-1', userId: 'user-1', __version: 1 }),
        ctx('INVESTOR_PROFILE_SNAPSHOT_UPDATED'),
      ),
    ).rejects.toThrow(/agentOutput/);
  });

  it('MARKET_SNAPSHOT_UPDATED → projectVersioned keyed on subject.__version', async () => {
    const result = await handlers.MARKET_SNAPSHOT_UPDATED(
      payload({
        region: 'us-east-1',
        agentOutput: { signals: ['risk-on'], regime: 'BULL' },
        fastComponentsAt: '2026-05-17T12:00:00Z',
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
    expect(JSON.parse(fields.agentOutput as string)).toEqual({ signals: ['risk-on'], regime: 'BULL' });
    expect(typeof fields.updatedAt).toBe('string');
    expect(fields.pk).toBeUndefined();
    expect(fields.sk).toBeUndefined();
  });

  it('MARKET_SNAPSHOT_UPDATED drops (undefined) when __version is absent', async () => {
    const result = await handlers.MARKET_SNAPSHOT_UPDATED(
      payload({ region: 'us-east-1', agentOutput: { signals: [] } }),
      ctx('MARKET_SNAPSHOT_UPDATED', { tenantId: 'SYSTEM' }),
    );
    expect(result).toBeUndefined();
  });

  it('MARKET_SNAPSHOT_UPDATED defaults region to us-east-1 when subject.region missing', async () => {
    const result = await handlers.MARKET_SNAPSHOT_UPDATED(
      payload({ agentOutput: { signals: [] }, __version: 1 }),
      ctx('MARKET_SNAPSHOT_UPDATED', { tenantId: 'SYSTEM' }),
    );
    const intent = Array.isArray(result) ? result[0] : result;
    expect(intent!._tag).toBe('projectVersioned');
    expect((intent as { fields: Record<string, unknown> }).fields.region).toBe('us-east-1');
    expect((intent as { overrides?: { pk?: string } }).overrides?.pk).toBe(
      projectedMarketSnapshotPk('us-east-1'),
    );
  });

  it('MARKET_SNAPSHOT_UPDATED throws NotRetryableError when agentOutput missing', async () => {
    await expect(
      handlers.MARKET_SNAPSHOT_UPDATED(
        payload({ region: 'us-east-1', __version: 1 }),
        ctx('MARKET_SNAPSHOT_UPDATED', { tenantId: 'SYSTEM' }),
      ),
    ).rejects.toThrow(/agentOutput/);
  });
});

describe('snapshot-projector — LedgerSnapshot', () => {
  const handlers = createHandlers();

  it('projects PORTFOLIO_UPDATED into a LedgerSnapshot projectVersioned keyed on lastEventSequence', async () => {
    const result = await handlers[LedgerCtrlEventTypes.PORTFOLIO_UPDATED](
      payload({
        tenantId: 'tenant-abc',
        snapshot: {
          positions: { VTI: { quantity: 10, lastFillPrice: 200 } },
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
    expect(fields.sourceEventId).toBe('evt-1');
    expect(typeof fields.updatedAt).toBe('string');
  });

  it('LedgerSnapshot drops (undefined) when snapshot.lastEventSequence is absent', async () => {
    const result = await handlers[LedgerCtrlEventTypes.PORTFOLIO_UPDATED](
      payload({
        tenantId: 'tenant-abc',
        snapshot: { positions: {}, cashBalanceCents: 0 },
      }),
      ctx('PORTFOLIO_UPDATED', { tenantId: 'tenant-abc', eventId: 'evt-3' }),
    );
    expect(result).toBeUndefined();
  });

  it('raises NotRetryableError when subject.snapshot is missing', async () => {
    await expect(
      handlers[LedgerCtrlEventTypes.PORTFOLIO_UPDATED](
        payload({ tenantId: 'tenant-abc' }),
        ctx('PORTFOLIO_UPDATED', { tenantId: 'tenant-abc', eventId: 'evt-2' }),
      ),
    ).rejects.toThrow(/missing subject\.snapshot/);
  });
});
