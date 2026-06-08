// Producer-owned event payload contracts for investor-ctrl. Imports ONLY zod.
// NotificationCreatedSchema models the subject of NOTIFICATION_CREATED events
// emitted by investor-ctrl's CDC Egress. Consumers (e.g. investor-bff) import this
// schema via @nestfolio/investor-ctrl/contracts and parse at runtime with parseSubject.
import { z } from 'zod';

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
