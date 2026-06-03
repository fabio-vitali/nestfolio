import { createHandlers } from '../../src/handlers/mandate-projector';
import { mandateSnapshotPk, MANDATE_SNAPSHOT_SK } from '../../src/repositories/mandate-snapshot.repository';
import type { EventContext, EventPayload } from '@nestfolio/event-processor';

const ctx = (eventType: string, overrides: Partial<EventContext> = {}): EventContext => ({
  eventId: 'evt-1', eventType, tenantId: 'tenant-1', userId: 'user-1', region: 'us-east-1',
  ...overrides,
} as EventContext);

const payload = (subject: Record<string, unknown>): EventPayload => ({
  subject,
  context: { tenantId: 'tenant-1', userId: 'user-1', region: 'us-east-1' },
} as EventPayload);

const fullMandate = (overrides: Record<string, unknown> = {}) => ({
  tenantId: 'tenant-1', userId: 'user-1', operatingMode: 'BALANCED',
  level: 'ADVISORY', mandateId: 'm-1', effectiveDate: '2026-05-10T00:00:00Z',
  status: 'ACTIVE', __version: 1, ...overrides,
});

describe('mandate-projector (projectVersioned)', () => {
  const handlers = createHandlers();

  it('MANDATE_ISSUED → projectVersioned full row keyed on __version', async () => {
    const result = await handlers.MANDATE_ISSUED(payload(fullMandate()), ctx('MANDATE_ISSUED'));
    expect(result).toMatchObject({
      _tag: 'projectVersioned', typename: 'MandateSnapshot', version: 1,
      fields: expect.objectContaining({ operatingMode: 'BALANCED', level: 'ADVISORY', status: 'ACTIVE', mandateId: 'm-1' }),
      overrides: { pk: mandateSnapshotPk('tenant-1', 'user-1'), sk: MANDATE_SNAPSHOT_SK },
    });
  });

  it('OPERATING_MODE_CHANGED → projectVersioned full row at the new __version', async () => {
    const result = await handlers.OPERATING_MODE_CHANGED(
      payload(fullMandate({ operatingMode: 'AGGRESSIVE', __version: 2 })), ctx('OPERATING_MODE_CHANGED'),
    );
    expect(result).toMatchObject({
      _tag: 'projectVersioned', typename: 'MandateSnapshot', version: 2,
      fields: expect.objectContaining({ operatingMode: 'AGGRESSIVE', level: 'ADVISORY', mandateId: 'm-1' }),
    });
  });

  it('throws NotRetryableError when operatingMode missing', async () => {
    await expect(handlers.MANDATE_ISSUED(
      payload({ tenantId: 'tenant-1', userId: 'user-1', level: 'ADVISORY', mandateId: 'm-1', __version: 1 }),
      ctx('MANDATE_ISSUED'),
    )).rejects.toThrow(/operatingMode/);
  });

  it('returns skip() when __version missing', async () => {
    const result = await handlers.OPERATING_MODE_CHANGED(
      payload({ tenantId: 'tenant-1', userId: 'user-1', operatingMode: 'AGGRESSIVE' }), ctx('OPERATING_MODE_CHANGED'),
    );
    expect(result).toMatchObject({ _tag: 'skip' });
  });
});
