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
      advisoryStatus(makeUow({ tenantId: 't1', inFlightCount: 3, __version: 99 }) as any),
    ).toEqual(
      projectVersioned(
        'AdvisoryStatus',
        { pendingDecisionsCount: 3 },
        { version: 99, overrides: { pk: 'T#t1', sk: 'AdvisoryStatus' } },
      ),
    );
  });

  it('drops a subject with no __version (cannot order)', () => {
    expect(advisoryStatus(makeUow({ tenantId: 't1', inFlightCount: 3 }) as any)).toBeUndefined();
  });
});
