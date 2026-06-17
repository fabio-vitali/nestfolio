// Producer-owned event payload contracts for investor-ctrl. Imports ONLY zod.
// NotificationCreatedSchema models the subject of NOTIFICATION_CREATED events
// emitted by investor-ctrl's CDC Egress. Consumers (e.g. investor-bff) import this
// schema via @nestfolio/investor-ctrl/contracts and parse at runtime with parseSubject.
import { z } from 'zod';
import type { ZodTypeAny } from 'zod';

export const NotificationCreatedSchema = z.object({
  notificationId: z.string(),
  channel: z.string(),
  title: z.string(),
  body: z.string(),
  // relatedEntityType / relatedEntityId are derived in buildNotificationRecord
  // from the triggering event's subject (NOTIFICATION_ENTITY_MAP). They enable
  // the investor-mfe deep-link (DECISION → /advisory/:decisionId).
  relatedEntityType: z.string(),
  relatedEntityId: z.string(),
});

export type NotificationCreated = z.infer<typeof NotificationCreatedSchema>;

/** MONTHLY_REPORT_CREATED / MONTHLY_REPORT_UPDATED subject (the MonthlyReport row,
 * written by event-listener on ORDER_FILLED). Dry domain subject — tenant identity
 * travels in the event context (RequestContext), not here. */
export const MonthlyReportSchema = z.object({
  reportId: z.string(),
  period: z.string(),
  status: z.string(),
  sourceEventId: z.string().optional(),
  // orderDetails is the raw triggering ORDER_FILLED subject, persisted verbatim.
  orderDetails: z.record(z.unknown()).optional(),
});
export type MonthlyReport = z.infer<typeof MonthlyReportSchema>;

/**
 * Test-fixture event→subject map for investor-ctrl's CDC emissions.
 * NOTIFICATION_CREATED/UPDATED share NotificationCreatedSchema (same Notification row);
 * MONTHLY_REPORT_CREATED/UPDATED share MonthlyReportSchema. Consumed only by
 * `@nestfolio/test-contracts`.
 */
export const investorCtrlEventSubjects = {
  NOTIFICATION_CREATED: NotificationCreatedSchema,
  NOTIFICATION_UPDATED: NotificationCreatedSchema,
  MONTHLY_REPORT_CREATED: MonthlyReportSchema,
  MONTHLY_REPORT_UPDATED: MonthlyReportSchema,
} as const satisfies Record<string, ZodTypeAny>;
