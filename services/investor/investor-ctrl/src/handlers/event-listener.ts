import {
  type EventContext,
  type EventPayload,
  type TableEntry,
  getTime,
  materializeToTable,
  parseSubject,
  record,
  requireEnv,
  type WriteIntent,
} from '@nestfolio/event-processor';
import type { NotificationCreated } from '../domain/contracts';
import '../read-model-ownership';
import { InvestorBffEventTypes } from '@nestfolio/investor-bff/events';
import { AdvisoryCrossDomainEventTypes, ComplianceCheckSchema } from '@nestfolio/advisory-adpt/domain';
import {
  ExecutionCrossDomainEventTypes,
  FundingSnapshotSchema,
  NormalizedOrderEventSchema,
} from '@nestfolio/execution-adpt/domain';
import { LedgerCrossDomainEventTypes, BalanceUpdatedSchema } from '@nestfolio/ledger-adpt/domain';
import {
  InvestorIngestEventTypes,
  DepositInitiatedSchema,
  MandateSchema,
} from '@nestfolio/investor-adpt/domain';

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

/**
 * Builds a Notification WriteIntent from already-resolved entity fields.
 * Identity (tenantId) and metadata come from ctx; entity context is
 * passed in directly — callers derive it via parseSubject or from ctx.
 */
function buildNotificationRecord(
  tenantId: string,
  ctx: EventContext,
  relatedEntityType: string,
  relatedEntityId: string,
): WriteIntent {
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
      relatedEntityType,
      relatedEntityId,
      timestamp: now,
      createdAt: now,
      updatedAt: now,
    } satisfies TableEntry & Pick<NotificationCreated, 'relatedEntityType' | 'relatedEntityId'>,
    { pk: `Notification#${tenantId}#${notificationId}`, sk: 'Notification' },
  );
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const createHandlers = (_deps: EventListenerDeps) => ({

  // ── Advisory decisions ───────────────────────────────────────────────────
  // Schema: ComplianceCheckSchema (@nestfolio/advisory-adpt/domain → compliance-ctrl/contracts)
  // relatedEntityId: subject.decisionId
  [AdvisoryCrossDomainEventTypes.DECISION_APPROVED]: async (
    payload: EventPayload,
    ctx: EventContext,
  ): Promise<WriteIntent> => {
    const subject = parseSubject(payload, ComplianceCheckSchema);
    return buildNotificationRecord(ctx.tenantId, ctx, 'DECISION', subject.decisionId);
  },

  [AdvisoryCrossDomainEventTypes.DECISION_BLOCKED]: async (
    payload: EventPayload,
    ctx: EventContext,
  ): Promise<WriteIntent> => {
    const subject = parseSubject(payload, ComplianceCheckSchema);
    return buildNotificationRecord(ctx.tenantId, ctx, 'DECISION', subject.decisionId);
  },

  // ── Execution orders ─────────────────────────────────────────────────────
  // Schema: NormalizedOrderEventSchema (@nestfolio/execution-adpt/domain → broker-ctrl/contracts)
  // relatedEntityId: subject.orderId
  // ORDER_FILLED also builds a MonthlyReport — orderDetails carries the typed subject
  [ExecutionCrossDomainEventTypes.ORDER_FILLED]: async (
    payload: EventPayload,
    ctx: EventContext,
  ): Promise<WriteIntent | WriteIntent[]> => {
    const subject = parseSubject(payload, NormalizedOrderEventSchema);
    const notification = buildNotificationRecord(ctx.tenantId, ctx, 'ORDER', subject.orderId);

    const now = getTime();
    const reportId = `${ctx.eventId}-report`;
    const monthlyReport = record(
      'MonthlyReport',
      {
        __typename: 'MonthlyReport',
        tenantId: ctx.tenantId,
        reportId,
        period: getCurrentPeriod(),
        orderDetails: subject,
        sourceEventId: ctx.eventId,
        status: 'GENERATED',
        timestamp: now,
        createdAt: now,
        updatedAt: now,
      },
      { pk: `MonthlyReport#${ctx.tenantId}#${reportId}`, sk: 'MonthlyReport' },
    );

    return [notification, monthlyReport];
  },

  [ExecutionCrossDomainEventTypes.ORDER_REJECTED]: async (
    payload: EventPayload,
    ctx: EventContext,
  ): Promise<WriteIntent> => {
    const subject = parseSubject(payload, NormalizedOrderEventSchema);
    return buildNotificationRecord(ctx.tenantId, ctx, 'ORDER', subject.orderId);
  },

  // ── Execution funding ────────────────────────────────────────────────────
  // Schema: FundingSnapshotSchema (@nestfolio/execution-adpt/domain)
  // relatedEntityId: subject.transferId
  [ExecutionCrossDomainEventTypes.WITHDRAWAL_SETTLED]: async (
    payload: EventPayload,
    ctx: EventContext,
  ): Promise<WriteIntent> => {
    const subject = parseSubject(payload, FundingSnapshotSchema);
    return buildNotificationRecord(ctx.tenantId, ctx, 'WITHDRAWAL', subject.transferId);
  },

  // ── Investor deposits ────────────────────────────────────────────────────
  // Schema: DepositInitiatedSchema (@nestfolio/investor-adpt/domain)
  // relatedEntityId: subject.depositId
  [InvestorBffEventTypes.DEPOSIT_INITIATED]: async (
    payload: EventPayload,
    ctx: EventContext,
  ): Promise<WriteIntent> => {
    const subject = parseSubject(payload, DepositInitiatedSchema);
    return buildNotificationRecord(ctx.tenantId, ctx, 'DEPOSIT', subject.depositId);
  },

  // ── Investor mandates ────────────────────────────────────────────────────
  // Schema: MandateSchema (@nestfolio/investor-adpt/domain)
  // relatedEntityId: subject.mandateId
  [InvestorBffEventTypes.MANDATE_ISSUED]: async (
    payload: EventPayload,
    ctx: EventContext,
  ): Promise<WriteIntent> => {
    const subject = parseSubject(payload, MandateSchema);
    return buildNotificationRecord(ctx.tenantId, ctx, 'MANDATE', subject.mandateId);
  },

  [InvestorBffEventTypes.MANDATE_REVOKED]: async (
    payload: EventPayload,
    ctx: EventContext,
  ): Promise<WriteIntent> => {
    const subject = parseSubject(payload, MandateSchema);
    return buildNotificationRecord(ctx.tenantId, ctx, 'MANDATE', subject.mandateId);
  },

  // ── Profile events ───────────────────────────────────────────────────────
  // No subject read — relatedEntityId is ctx.userId (identity from context, not subject).
  // These events carry no schema-contracted entity id on the subject.
  [InvestorBffEventTypes.OPERATING_MODE_CHANGED]: async (
    _payload: EventPayload,
    ctx: EventContext,
  ): Promise<WriteIntent> => {
    return buildNotificationRecord(ctx.tenantId, ctx, 'PROFILE', ctx.userId);
  },

  [InvestorBffEventTypes.GOAL_UPDATED]: async (
    _payload: EventPayload,
    ctx: EventContext,
  ): Promise<WriteIntent> => {
    return buildNotificationRecord(ctx.tenantId, ctx, 'PROFILE', ctx.userId);
  },

  [InvestorBffEventTypes.ONBOARDING_COMPLETED]: async (
    _payload: EventPayload,
    ctx: EventContext,
  ): Promise<WriteIntent> => {
    return buildNotificationRecord(ctx.tenantId, ctx, 'PROFILE', ctx.userId);
  },

  // ── Balance ──────────────────────────────────────────────────────────────
  // Schema: BalanceUpdatedSchema (@nestfolio/ledger-adpt/domain → ledger-ctrl/contracts)
  // No natural entity id — parseSubject validates the contract, relatedEntityId falls back to ctx.eventId.
  [LedgerCrossDomainEventTypes.BALANCE_UPDATED]: async (
    payload: EventPayload,
    ctx: EventContext,
  ): Promise<WriteIntent> => {
    parseSubject(payload, BalanceUpdatedSchema); // validate contract; no id field on this schema
    return buildNotificationRecord(ctx.tenantId, ctx, 'BALANCE', ctx.eventId);
  },

  // ── Circuit-breaker system events ────────────────────────────────────────
  // boundary: BROKER_CIRCUIT_OPEN/CLOSED/BROKER_HEAL_ESCALATED carry no subject payload.
  // These originate in broker-alpaca-adpt and traverse multiple buses with no structured subject.
  [InvestorIngestEventTypes.BROKER_CIRCUIT_OPEN]: async (
    _payload: EventPayload,
    ctx: EventContext,
  ): Promise<WriteIntent> => {
    return buildNotificationRecord('SYSTEM', ctx, 'SYSTEM', ctx.eventId);
  },

  [InvestorIngestEventTypes.BROKER_CIRCUIT_CLOSED]: async (
    _payload: EventPayload,
    ctx: EventContext,
  ): Promise<WriteIntent> => {
    return buildNotificationRecord('SYSTEM', ctx, 'SYSTEM', ctx.eventId);
  },

  [InvestorIngestEventTypes.BROKER_HEAL_ESCALATED]: async (
    _payload: EventPayload,
    ctx: EventContext,
  ): Promise<WriteIntent> => {
    return buildNotificationRecord('SYSTEM', ctx, 'SYSTEM', ctx.eventId);
  },
});

// Production wiring
requireEnv('TABLE_NAME');
const deps: EventListenerDeps = {};

export const handler = materializeToTable({
  serviceName: 'investor-ctrl',
  handlers: createHandlers(deps),
  errorEventType: 'INVESTOR_CTRL_FAILED',
});
