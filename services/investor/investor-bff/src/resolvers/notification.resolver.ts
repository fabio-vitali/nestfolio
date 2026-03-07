import type { Notification } from '@nestfolio/domain-core';
import { InvestorProfileRepository } from '../repositories/investor-profile.repository';

export async function getNotifications(
  repository: InvestorProfileRepository,
  tenantId: string,
  userId: string,
  limit?: number,
  cursor?: string,
): Promise<{ items: Notification[]; nextCursor: string | null }> {
  return repository.getNotifications(tenantId, userId, limit, cursor);
}

export async function getUnreadCount(
  repository: InvestorProfileRepository,
  tenantId: string,
  userId: string,
): Promise<number> {
  return repository.getUnreadCount(tenantId, userId);
}

export async function markNotificationRead(
  repository: InvestorProfileRepository,
  tenantId: string,
  userId: string,
  notificationId: string,
): Promise<Notification> {
  return repository.markNotificationRead(tenantId, userId, notificationId);
}
