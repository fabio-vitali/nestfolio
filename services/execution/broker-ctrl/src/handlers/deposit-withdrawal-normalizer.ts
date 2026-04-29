import { materializeToTable, normalizedEvent, type EventPayload, type EventContext } from '@nestfolio/event-processor';
import { BrokerCtrlInboundEventTypes } from '../domain/events';

export const handler = materializeToTable({
  serviceName: 'broker-ctrl',
  handlers: {
    [BrokerCtrlInboundEventTypes.SIM_DEPOSIT_COMPLETED]: (payload: EventPayload, ctx: EventContext) => {
      const subject = payload.subject as Record<string, unknown>;
      const depositId = (subject.depositId as string) ?? ctx.eventId;
      return normalizedEvent({
        tenantId: ctx.tenantId,
        userId: (subject.userId as string) ?? ctx.userId,
        region: ctx.region,
        depositId,
        amountCents: subject.amountCents,
        currency: (subject.currency as string) ?? 'USD',
        executionMode: 'simulation',
        timestamp: ctx.timestamp,
      }, {
        pk: `NormalizedEvent#${ctx.tenantId}#${depositId}`,
        sk: 'DEPOSIT_DETECTED',
      });
    },

    [BrokerCtrlInboundEventTypes.SIM_WITHDRAWAL_COMPLETED]: (payload: EventPayload, ctx: EventContext) => {
      const subject = payload.subject as Record<string, unknown>;
      return normalizedEvent({
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        region: ctx.region,
        amount: subject.amount,
        currency: (subject.currency as string) ?? 'USD',
        executionMode: 'simulation',
        timestamp: ctx.timestamp,
      }, {
        pk: `NormalizedEvent#${ctx.tenantId}#${(subject.withdrawalId as string) ?? ctx.eventId}`,
        sk: 'WITHDRAWAL_COMPLETED',
      });
    },

    [BrokerCtrlInboundEventTypes.ALPACA_TRANSFER_COMPLETED]: (payload: EventPayload, ctx: EventContext) => {
      const subject = payload.subject as Record<string, unknown>;
      const isDeposit = subject.direction === 'INCOMING';
      return normalizedEvent({
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        region: ctx.region,
        amount: subject.amount,
        executionMode: 'live',
        timestamp: ctx.timestamp,
      }, {
        pk: `NormalizedEvent#${ctx.tenantId}#${(subject.transferId as string) ?? ctx.eventId}`,
        sk: isDeposit ? 'DEPOSIT_DETECTED' : 'WITHDRAWAL_COMPLETED',
      });
    },

    [BrokerCtrlInboundEventTypes.ALPACA_TRANSFER_FAILED]: (payload: EventPayload, ctx: EventContext) => {
      const subject = payload.subject as Record<string, unknown>;
      return normalizedEvent({
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        region: ctx.region,
        amount: subject.amount,
        executionMode: 'live',
        failureReason: (subject.failureReason as string) ?? 'Transfer failed',
        timestamp: ctx.timestamp,
      }, {
        pk: `NormalizedEvent#${ctx.tenantId}#${(subject.transferId as string) ?? ctx.eventId}`,
        sk: 'TRANSFER_FAILED',
      });
    },
  },
});
