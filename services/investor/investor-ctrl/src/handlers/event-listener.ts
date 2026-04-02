import {
  type EventContext,
  type EventPayload,
  getTime,
  materializeToTable,
  record,
  requireEnv,
  type WriteIntent,
} from '@nestfolio/event-processor';
import { InvestorBffEventTypes } from '@nestfolio/investor-bff/events';
import { AdvisoryCrossDomainEventTypes } from '@nestfolio/advisory-adpt/domain';
import { ExecutionCrossDomainEventTypes } from '@nestfolio/execution-adpt/domain';
import { LedgerCrossDomainEventTypes } from '@nestfolio/ledger-adpt/domain';

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
  MANDATE_CREATED: {
    title: 'Investment Mandate Activated',
    body: 'Your investment mandate has been granted. We will start managing your portfolio.',
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
  WITHDRAWAL_COMPLETED: {
    title: 'Withdrawal Completed',
    body: 'Your withdrawal has been processed successfully.',
    channel: 'email',
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

const EVENT_TYPES = [
  InvestorBffEventTypes.ONBOARDING_COMPLETED,
  InvestorBffEventTypes.MANDATE_CREATED,
  InvestorBffEventTypes.GOAL_UPDATED,
  InvestorBffEventTypes.DEPOSIT_INITIATED,
  InvestorBffEventTypes.OPERATING_MODE_CHANGED,
  AdvisoryCrossDomainEventTypes.DECISION_APPROVED,
  ExecutionCrossDomainEventTypes.ORDER_FILLED,
  LedgerCrossDomainEventTypes.BALANCE_UPDATED,
  ExecutionCrossDomainEventTypes.ORDER_REJECTED,
  ExecutionCrossDomainEventTypes.WITHDRAWAL_COMPLETED,
  AdvisoryCrossDomainEventTypes.DECISION_BLOCKED,
] as const;

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const createHandlers = (_deps: EventListenerDeps) =>
  Object.fromEntries(
    EVENT_TYPES.map((type) => [
      type,
      async (payload: EventPayload, ctx: EventContext): Promise<WriteIntent | WriteIntent[]> => {
        const tenantId = ctx.tenantId;
        const notificationId = ctx.eventId;
        const now = getTime();
        const template = getNotificationTemplate(ctx.eventType);

        const notification = record(
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

        if (ctx.eventType === ExecutionCrossDomainEventTypes.ORDER_FILLED) {
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
  );

// Production wiring
requireEnv('TABLE_NAME');
const deps: EventListenerDeps = {};

export const handler = materializeToTable({
  serviceName: 'investor-ctrl',
  handlers: createHandlers(deps),
  errorEventType: 'INVESTOR_CTRL_FAILED',
});
