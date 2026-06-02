import {
  type EventContext,
  type EventPayload,
  getTime,
  materializeToTable,
  record,
  requireEnv,
  type WriteIntent,
} from '@nestfolio/event-processor';
import '../read-model-ownership';
import { InvestorBffEventTypes } from '@nestfolio/investor-bff/events';
import { AdvisoryCrossDomainEventTypes } from '@nestfolio/advisory-adpt/domain';
import { ExecutionCrossDomainEventTypes } from '@nestfolio/execution-adpt/domain';
import { LedgerCrossDomainEventTypes } from '@nestfolio/ledger-adpt/domain';
import { InvestorIngestEventTypes } from '@nestfolio/investor-adpt/domain';

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface EventListenerDeps {}

interface NotificationTemplate {
  readonly title: string;
  readonly body: string;
  readonly channel: string;
}

const NOTIFICATION_TEMPLATES: Record<string, NotificationTemplate> = {
  ONBOARDING_COMPLETED: {
    title: 'Welcome to Nestfolio',
    body: 'Your account setup is complete. You can now start investing.',
    channel: 'email',
  },
  MANDATE_ISSUED: {
    title: 'Investment Mandate Activated',
    body: 'Your investment mandate has been granted. We will start managing your portfolio.',
    channel: 'push',
  },
  MANDATE_REVOKED: {
    title: 'Mandate Revoked',
    body: 'Your investment mandate has been revoked. No further automated trades will be authorized.',
    channel: 'push',
  },
  GOAL_UPDATED: {
    title: 'Goal Updated',
    body: 'Your investment goal has been updated successfully.',
    channel: 'push',
  },
  DEPOSIT_INITIATED: {
    title: 'Deposit Received',
    body: 'Your deposit has been initiated and is being processed.',
    channel: 'push',
  },
  OPERATING_MODE_CHANGED: {
    title: 'Operating Mode Changed',
    body: 'Your portfolio operating mode has been updated.',
    channel: 'push',
  },
  DECISION_APPROVED: {
    title: 'Investment Decision Approved',
    body: 'An investment decision has been approved for your portfolio.',
    channel: 'push',
  },
  ORDER_FILLED: {
    title: 'Order Executed',
    body: 'A trade order has been filled in your portfolio.',
    channel: 'email',
  },
  ORDER_REJECTED: {
    title: 'Order Rejected',
    body: 'A trade order has been rejected. Check your dashboard for details.',
    channel: 'push',
  },
  DECISION_BLOCKED: {
    title: 'Decision Blocked',
    body: 'An investment decision was blocked by compliance. Review required.',
    channel: 'push',
  },
  WITHDRAWAL_SETTLED: {
    title: 'Withdrawal Completed',
    body: 'Your withdrawal has been processed successfully.',
    channel: 'email',
  },
  BROKER_CIRCUIT_OPEN: {
    title: 'Some features are temporarily paused',
    body: "Deposits, withdrawals, and accepting decisions are temporarily paused. We're working on it and will notify you when they're available again.",
    channel: 'push',
  },
  BROKER_CIRCUIT_CLOSED: {
    title: 'All features are available',
    body: 'Everything is back to normal. All features are available again.',
    channel: 'push',
  },
  BROKER_HEAL_ESCALATED: {
    title: "We're looking into an issue",
    body: "We're experiencing an extended issue affecting some features. Our team is working on it — we'll update you as soon as it's resolved.",
    channel: 'email,push',
  },
};

export function getNotificationTemplate(eventType: string): NotificationTemplate {
  return (
    NOTIFICATION_TEMPLATES[eventType] ?? {
      title: 'Notification',
      body: `Event ${eventType} occurred.`,
      channel: 'push',
    }
  );
}

function getCurrentPeriod(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

// Direct-subscription event types — each produces exactly one Notification.
// OPERATING_MODE_CHANGED and GOAL_UPDATED are now emitted directly by investor-bff
// CDC (Phase 1 diff-emit), making the old INVESTOR_PROFILE_UPDATED diff handler obsolete.
const EVENT_TYPES = [
  InvestorBffEventTypes.ONBOARDING_COMPLETED,
  InvestorBffEventTypes.MANDATE_ISSUED,
  InvestorBffEventTypes.MANDATE_REVOKED,
  InvestorBffEventTypes.DEPOSIT_INITIATED,
  InvestorBffEventTypes.OPERATING_MODE_CHANGED,
  InvestorBffEventTypes.GOAL_UPDATED,
  AdvisoryCrossDomainEventTypes.DECISION_APPROVED,
  ExecutionCrossDomainEventTypes.ORDER_FILLED,
  LedgerCrossDomainEventTypes.BALANCE_UPDATED,
  ExecutionCrossDomainEventTypes.ORDER_REJECTED,
  ExecutionCrossDomainEventTypes.WITHDRAWAL_SETTLED,
  AdvisoryCrossDomainEventTypes.DECISION_BLOCKED,
] as const;

const SYSTEM_EVENT_TYPES = [
  InvestorIngestEventTypes.BROKER_CIRCUIT_OPEN,
  InvestorIngestEventTypes.BROKER_CIRCUIT_CLOSED,
  InvestorIngestEventTypes.BROKER_HEAL_ESCALATED,
] as const;

function buildNotificationRecord(tenantId: string, ctx: EventContext): WriteIntent {
  const notificationId = ctx.eventId;
  const now = getTime();
  const template = getNotificationTemplate(ctx.eventType);
  return record(
    'Notification',
    {
      __typename: 'Notification',
      tenantId,
      notificationId,
      type: ctx.eventType,
      title: template.title,
      body: template.body,
      channel: template.channel,
      status: 'DELIVERED',
      sourceEventId: ctx.eventId,
      timestamp: now,
      createdAt: now,
      updatedAt: now,
    },
    { pk: `Notification#${tenantId}#${notificationId}`, sk: 'Notification' },
  );
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const createHandlers = (_deps: EventListenerDeps) => ({
  ...Object.fromEntries(
    EVENT_TYPES.map((type) => [
      type,
      async (payload: EventPayload, ctx: EventContext): Promise<WriteIntent | WriteIntent[]> => {
        const tenantId = ctx.tenantId;
        const notification = buildNotificationRecord(tenantId, ctx);

        if (ctx.eventType === ExecutionCrossDomainEventTypes.ORDER_FILLED) {
          const now = getTime();
          const reportId = `${ctx.eventId}-report`;
          const subject = (payload.subject ?? {}) as Record<string, unknown>;

          const monthlyReport = record(
            'MonthlyReport',
            {
              __typename: 'MonthlyReport',
              tenantId,
              reportId,
              period: getCurrentPeriod(),
              orderDetails: subject,
              sourceEventId: ctx.eventId,
              status: 'GENERATED',
              timestamp: now,
              createdAt: now,
              updatedAt: now,
            },
            { pk: `MonthlyReport#${tenantId}#${reportId}`, sk: 'MonthlyReport' },
          );

          return [notification, monthlyReport];
        }

        return notification;
      },
    ]),
  ),
  ...Object.fromEntries(
    SYSTEM_EVENT_TYPES.map((type) => [
      type,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      async (_payload: EventPayload, ctx: EventContext): Promise<WriteIntent> => {
        return buildNotificationRecord('SYSTEM', ctx);
      },
    ]),
  ),
});

// Production wiring
requireEnv('TABLE_NAME');
const deps: EventListenerDeps = {};

export const handler = materializeToTable({
  serviceName: 'investor-ctrl',
  handlers: createHandlers(deps),
  errorEventType: 'INVESTOR_CTRL_FAILED',
});
