import { AdvisoryStatusSchema } from '../../src/domain/contracts';

describe('advisory-bff AdvisoryStatus contract', () => {
  it('parses the real AdvisoryStatus row (DRY — tenantId + envelope stripped, __version retained)', () => {
    const subject = AdvisoryStatusSchema.parse({
      pk: 'T#tenant-1', sk: 'AdvisoryStatus', __typename: 'AdvisoryStatus', tenantId: 'tenant-1',
      inFlightCount: 2, generatingCount: 1, failedCount: 0, oldestGeneratingAt: '2026-01-01T00:00:00Z',
      __version: 5, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:01Z',
    });
    expect(subject).toEqual({
      inFlightCount: 2, generatingCount: 1, failedCount: 0,
      oldestGeneratingAt: '2026-01-01T00:00:00Z', __version: 5,
    });
    expect((subject as Record<string, unknown>).tenantId).toBeUndefined();
    expect((subject as Record<string, unknown>).pk).toBeUndefined();
  });

  it('accepts a null oldestGeneratingAt (no GENERATING decisions)', () => {
    const subject = AdvisoryStatusSchema.parse({
      inFlightCount: 0, generatingCount: 0, failedCount: 0, oldestGeneratingAt: null, __version: 1,
    });
    expect(subject.oldestGeneratingAt).toBeNull();
  });
});
