import { createHandlers } from '../../../src/handlers/event-listener';
import type { EventPayload, EventContext } from '@nestfolio/event-processor';

// SE-001 contracted gap validation — the dashboard recent-activity feed must
// surface an "awaiting confirmation" item sourced from the DecisionPacket
// AWAITING_CONFIRMATION status via the existing row CDC
// (DECISION_PACKET_UPDATED, forwarded advisory→investor by investor-adpt),
// never from the removed dead USER_CONFIRMATION_REQUESTED event.
// At the pre-implementation revision this file fails (no handler, no
// projection — the backlog gap); after the status-filtered projection is
// wired it passes unchanged.

// Full DecisionPacketSchema-shaped CDC subject (DRY: identity travels in the
// event context, not the subject — decision-workflow-ctrl/domain/contracts.ts).
const awaitingConfirmationPacket = {
  decisionId: 'd-awaiting-1',
  trigger: 'PORTFOLIO_DRIFT',
  triggerEventId: 'evt-trigger-1',
  executionArn: null,
  explanation: 'Rebalance proposal awaiting investor confirmation',
  proposedTrades: [{ symbol: 'AAPL', side: 'BUY', quantityDelta: 5 }],
  confirmationRequired: true,
  status: 'AWAITING_CONFIRMATION',
  __version: 3,
  complianceResult: 'PASS',
  authorityLevel: 'L2',
  userDecision: null,
  blockReason: null,
  rejectionReason: null,
  timestamp: '2026-07-17T10:00:00.000Z',
  createdAt: '2026-07-17T09:59:00.000Z',
  updatedAt: '2026-07-17T10:00:00.000Z',
  taskToken: 'task-token-1',
};

const makeCtx = (eventId: string): EventContext => ({
  eventId,
  eventType: 'DECISION_PACKET_UPDATED',
  timestamp: '2026-07-17T10:00:00.100Z',
  tenantId: 't1',
  userId: 'u1',
  region: 'us-east-1',
}) as unknown as EventContext;

type Intent = {
  _tag: string;
  typename: string;
  fields: Record<string, unknown>;
  overrides?: { pk?: string; sk?: string };
};

type Handler = (payload: EventPayload, ctx: EventContext) => unknown;

const runHandler = (subject: Record<string, unknown>, eventId: string): Intent[] => {
  const handlers = createHandlers() as unknown as Record<string, Handler>;
  const handler = handlers['DECISION_PACKET_UPDATED'];
  // The gap: without the status-filtered projection there is no handler at all.
  expect(handler).toBeDefined();
  const payload = { subject } as unknown as EventPayload;
  return [handler(payload, makeCtx(eventId))].flat().filter(Boolean) as Intent[];
};

describe('SE-001 gap validation: awaiting-confirmation activity projection', () => {
  it('records one awaiting-confirmation Activity row per decision from DECISION_PACKET_UPDATED', () => {
    const intents = runHandler(awaitingConfirmationPacket, 'evt-cdc-1');
    const activity = intents.filter((i) => i._tag === 'record' && i.typename === 'Activity');
    expect(activity).toHaveLength(1);
    expect(activity[0].overrides?.sk).toBe('Activity#awaiting-confirmation#d-awaiting-1');
    expect(activity[0].fields['activityType']).toBe('DECISION_PACKET_UPDATED');
    expect(String(activity[0].fields['description'])).toMatch(/awaiting.*confirmation/i);
  });

  it('keys the row by decisionId so redeliveries collapse to one row per decision', () => {
    const first = runHandler(awaitingConfirmationPacket, 'evt-cdc-1');
    const redelivered = runHandler({ ...awaitingConfirmationPacket, __version: 4 }, 'evt-cdc-2');
    const skOf = (intents: Intent[]): string | undefined =>
      intents.find((i) => i._tag === 'record' && i.typename === 'Activity')?.overrides?.sk;
    expect(skOf(first)).toBeDefined();
    expect(skOf(first)).toBe(skOf(redelivered));
  });

  it('does not record an Activity row for non-awaiting DecisionPacket updates', () => {
    const confirmed = {
      ...awaitingConfirmationPacket,
      status: 'CONFIRMED',
      userDecision: 'CONFIRMED',
      taskToken: undefined,
      confirmedAt: '2026-07-17T10:05:00.000Z',
      __version: 5,
    };
    const intents = runHandler(confirmed, 'evt-cdc-3');
    expect(intents).toHaveLength(0);
  });
});
