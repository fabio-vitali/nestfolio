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

describe('mandate-projector', () => {
  const handlers = createHandlers();

  it('MANDATE_ISSUED → record() with operatingMode + level + ACTIVE status', async () => {
    const result = await handlers.MANDATE_ISSUED(payload({
      tenantId: 'tenant-1', userId: 'user-1', operatingMode: 'BALANCED',
      level: 'ADVISORY', mandateId: 'm-1', effectiveDate: '2026-05-10T00:00:00Z',
    }), ctx('MANDATE_ISSUED'));
    const intent = Array.isArray(result) ? result[0] : result;
    expect(intent._tag).toBe('record');
    expect(intent.typename).toBe('MandateSnapshot');
    expect((intent as { overrides?: { pk?: string; sk?: string } }).overrides?.pk).toBe(mandateSnapshotPk('tenant-1', 'user-1'));
    expect((intent as { overrides?: { pk?: string; sk?: string } }).overrides?.sk).toBe(MANDATE_SNAPSHOT_SK);
    expect((intent as { fields: Record<string, unknown> }).fields.operatingMode).toBe('BALANCED');
    expect((intent as { fields: Record<string, unknown> }).fields.status).toBe('ACTIVE');
  });

  it('MANDATE_ISSUED throws NotRetryableError when operatingMode missing', async () => {
    await expect(handlers.MANDATE_ISSUED(payload({
      tenantId: 'tenant-1', userId: 'user-1', level: 'ADVISORY', mandateId: 'm-1',
    }), ctx('MANDATE_ISSUED'))).rejects.toThrow(/operatingMode/);
  });

  it('OPERATING_MODE_CHANGED → update() patching only operatingMode', async () => {
    const result = await handlers.OPERATING_MODE_CHANGED(payload({
      tenantId: 'tenant-1', userId: 'user-1', operatingMode: 'AGGRESSIVE',
    }), ctx('OPERATING_MODE_CHANGED'));
    const intent = Array.isArray(result) ? result[0] : result;
    expect(intent._tag).toBe('update');
    expect((intent as { updates: Record<string, unknown> }).updates.operatingMode).toBe('AGGRESSIVE');
  });
});
