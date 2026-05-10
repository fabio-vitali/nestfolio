import { accumulate, update } from '@nestfolio/event-processor';
import type { UnitOfWork, BusEvent } from '@nestfolio/event-processor';
import { decisionTriggerReceived } from '../../../src/transforms/decision-trigger-received';

type TestUow = UnitOfWork<BusEvent<{ tenantId: string }>>;

const TRIGGER_EVENTS = [
  'ADVISORY_PIPELINE_READY',
  'INVESTOR_PROFILE_UPDATED',
  'PORTFOLIO_DRIFT_DETECTED',
  'ORDER_FILLED',
  'ORDER_REJECTED',
  'ORDER_CANCELLED',
  'DEPOSIT_DETECTED',
];

describe('decisionTriggerReceived transform', () => {
  const makeUow = (eventType: string): TestUow => ({
    event: {
      id: 'e1',
      type: eventType,
      timestamp: '2026-01-01T00:00:00.000Z',
      subject: { tenantId: 't1' },
      context: { tenantId: 't1' },
    },
    payload: { tenantId: 't1' },
    record: {},
  }) as unknown as TestUow;

  TRIGGER_EVENTS.forEach((trigger) => {
    it(`returns +1 accumulate + lastTriggerAt update for ${trigger}`, () => {
      const intents = decisionTriggerReceived(makeUow(trigger));
      expect(intents).toEqual([
        accumulate('AdvisoryStatus', {
          field: 'inFlightCount',
          increment: 1,
          overrides: { pk: 'T#t1', sk: 'AdvisoryStatus' },
        }),
        update('AdvisoryStatus', {
          lastTriggerAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        }, { overrides: { pk: 'T#t1', sk: 'AdvisoryStatus' } }),
      ]);
    });
  });
});
