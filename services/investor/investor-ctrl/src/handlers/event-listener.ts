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
  WITHDRAWAL_COMPLETED: {
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

const EVENT_TYPES = [
  InvestorBffEventTypes.ONBOARDING_COMPLETED,
  InvestorBffEventTypes.MANDATE_ISSUED,
  InvestorBffEventTypes.MANDATE_REVOKED,
  InvestorBffEventTypes.DEPOSIT_INITIATED,
  AdvisoryCrossDomainEventTypes.DECISION_APPROVED,
  ExecutionCrossDomainEventTypes.ORDER_FILLED,
  LedgerCrossDomainEventTypes.BALANCE_UPDATED,
  ExecutionCrossDomainEventTypes.ORDER_REJECTED,
  ExecutionCrossDomainEventTypes.WITHDRAWAL_COMPLETED,
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

/**
 * Build a Notification WriteIntent for a synthesised eventType derived from an
 * INVESTOR_PROFILE_UPDATED diff. The resulting notification id is suffixed with
 * the synthesised type so multiple notifications produced by the same source
 * event don't collide on (pk, sk).
 */
function buildSynthesisedNotificationRecord(
  tenantId: string,
  ctx: EventContext,
  syntheticType: string,
): WriteIntent {
  const notificationId = `${ctx.eventId}-${syntheticType}`;
  const now = getTime();
  const template = getNotificationTemplate(syntheticType);
  return record(
    'Notification',
    {
      __typename: 'Notification',
      tenantId,
      notificationId,
      type: syntheticType,
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

/**
 * Diff-detect goal.* and operatingMode changes between previous and new
 * InvestorProfile composite-row subjects. Returns 0–2 Notification WriteIntents.
 *
 * Behaviour:
 *   - previous undefined/null      → fire BOTH (treat as all fields newly appearing)
 *   - goal differs                 → fire GOAL_UPDATED notification
 *   - operatingMode differs        → fire OPERATING_MODE_CHANGED notification
 *   - neither differs              → no notifications
 *
 * Note: today's CDC envelope (libs/event-processor/src/pipelines/change-data-capture.ts)
 * does NOT propagate previousSubject from OldImage. Until that's wired, this helper
 * receives `previous = undefined` and falls back to the "fire both" branch on every
 * INVESTOR_PROFILE_UPDATED. Tracked in PARKING LOT.
 */
export function deriveProfileUpdateNotifications(
  previous: Record<string, unknown> | undefined | null,
  next: Record<string, unknown>,
  ctx: EventContext,
): WriteIntent[] {
  const tenantId = ctx.tenantId;

  // Null/missing OldImage → cannot diff; fire both notifications conservatively.
  if (previous === undefined || previous === null) {
    return [
      buildSynthesisedNotificationRecord(tenantId, ctx, 'GOAL_UPDATED'),
      buildSynthesisedNotificationRecord(tenantId, ctx, 'OPERATING_MODE_CHANGED'),
    ];
  }

  const intents: WriteIntent[] = [];

  const prevGoal = JSON.stringify(previous['goal'] ?? null);
  const nextGoal = JSON.stringify(next['goal'] ?? null);
  if (prevGoal !== nextGoal) {
    intents.push(buildSynthesisedNotificationRecord(tenantId, ctx, 'GOAL_UPDATED'));
  }

  if (previous['operatingMode'] !== next['operatingMode']) {
    intents.push(buildSynthesisedNotificationRecord(tenantId, ctx, 'OPERATING_MODE_CHANGED'));
  }

  return intents;
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
  // INVESTOR_PROFILE_UPDATED is bespoke — diff-detect goal.* and operatingMode
  // and emit 0–2 synthesised Notifications (GOAL_UPDATED / OPERATING_MODE_CHANGED).
  [InvestorBffEventTypes.INVESTOR_PROFILE_UPDATED]: async (
    payload: EventPayload,
    ctx: EventContext,
  ): Promise<WriteIntent[]> => {
    const next = (payload.subject ?? {}) as Record<string, unknown>;
    const previous = ((payload as unknown as { previousSubject?: Record<string, unknown> | null })
      .previousSubject) ?? undefined;
    return deriveProfileUpdateNotifications(previous, next, ctx);
  },
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
