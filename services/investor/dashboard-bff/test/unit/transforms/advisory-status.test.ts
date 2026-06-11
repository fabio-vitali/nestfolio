import { projectVersioned } from '@nestfolio/event-processor';
import { advisoryStatus } from '../../../src/transforms/advisory-status';

const makeUow = (subject: Record<string, unknown>) => ({
  event: {
    id: 'e1',
    type: 'ADVISORY_STATUS_UPDATED',
    timestamp: '2026-01-01T00:00:00.000Z',
    subject,
    context: { tenantId: 't1' },
  },
  payload: {},
  record: {},
});

describe('advisoryStatus transform (P3 projection)', () => {
  it('projects the announced AdvisoryStatus aggregate (mapping inFlightCount→pendingDecisionsCount)', () => {
    expect(
      advisoryStatus(makeUow({ inFlightCount: 3, __version: 99 }) as any),
    ).toEqual(
      projectVersioned(
        'AdvisoryStatus',
        { pendingDecisionsCount: 3, generatingCount: 0, failedCount: 0, oldestGeneratingAt: null },
        { version: 99, overrides: { pk: 'T#t1', sk: 'AdvisoryStatus' } },
      ),
    );
  });

  it('drops a subject with no __version (cannot order)', () => {
    expect(advisoryStatus(makeUow({ inFlightCount: 3 }) as any)).toBeUndefined();
  });

  it('projects the generating/failed cycle signals onto the P3 row', () => {
    expect(
      advisoryStatus(makeUow({
        inFlightCount: 0, generatingCount: 1, failedCount: 0,
        oldestGeneratingAt: '2026-06-05T09:00:00.000Z', __version: 5,
      }) as any),
    ).toEqual(
      projectVersioned(
        'AdvisoryStatus',
        {
          pendingDecisionsCount: 0, generatingCount: 1, failedCount: 0,
          oldestGeneratingAt: '2026-06-05T09:00:00.000Z',
        },
        { version: 5, overrides: { pk: 'T#t1', sk: 'AdvisoryStatus' } },
      ),
    );
  });

  it('defaults the new fields when an older producer omits them (rollout safety)', () => {
    expect(
      advisoryStatus(makeUow({ inFlightCount: 2, __version: 7 }) as any),
    ).toEqual(
      projectVersioned(
        'AdvisoryStatus',
        { pendingDecisionsCount: 2, generatingCount: 0, failedCount: 0, oldestGeneratingAt: null },
        { version: 7, overrides: { pk: 'T#t1', sk: 'AdvisoryStatus' } },
      ),
    );
  });
});
