import { getUUID, logger, type BusEvent } from '@nestfolio/platform-core';
import { withMethodLogging } from '@nestfolio/lambda-utils';
import { NotificationRepository } from '../repositories/notification.repository';

export interface NotificationContext {
  tenantId: string;
  triggerEvent: BusEvent;
}

export interface NotificationResult {
  notificationId: string;
  status: 'COMPLETED';
}

interface NotificationContent {
  title: string;
  body: string;
  channel: string;
}

export class NotificationLifecycleService {
  private readonly log = withMethodLogging('NotificationLifecycleService');

  constructor(private readonly repository: NotificationRepository) {}

  readonly executeNotificationLifecycle = this.log('executeNotificationLifecycle',
    async (context: NotificationContext): Promise<NotificationResult> => {
      const notificationId = getUUID();
      const content = this.getNotificationContent(context.triggerEvent.type);

      // 1. Create notification
      await this.repository.createNotification(context.tenantId, notificationId, {
        title: content.title,
        body: content.body,
        channel: content.channel,
        triggerEventType: context.triggerEvent.type,
        triggerEventId: context.triggerEvent.id,
      });

      // 2. Update status to SENT (stub - in production would dispatch to SNS/SES)
      await this.repository.updateNotificationStatus(
        context.tenantId,
        notificationId,
        'SENT',
        { sentAt: new Date().toISOString() },
      );

      // 3. Update status to DELIVERED (stub)
      await this.repository.updateNotificationStatus(
        context.tenantId,
        notificationId,
        'DELIVERED',
        { deliveredAt: new Date().toISOString() },
      );

      // 4. For ORDER_FILLED events, also create monthly report
      if (context.triggerEvent.type === 'ORDER_FILLED') {
        const reportId = getUUID();
        const subject = (context.triggerEvent.subject as Record<string, unknown>) ?? {};
        await this.repository.createMonthlyReport(context.tenantId, reportId, {
          period: this.getCurrentPeriod(),
          orderDetails: subject,
          triggerEventId: context.triggerEvent.id,
          status: 'GENERATED',
        });

        logger.info('Monthly report generated for ORDER_FILLED', {
          tenantId: context.tenantId,
          reportId,
        });
      }

      logger.info('Notification lifecycle completed', {
        tenantId: context.tenantId,
        notificationId,
        eventType: context.triggerEvent.type,
      });

      return {
        notificationId,
        status: 'COMPLETED',
      };
    },
  );

  private getNotificationContent(eventType: string): NotificationContent {
    const contentMap: Record<string, NotificationContent> = {
      ONBOARDING_COMPLETED: {
        title: 'Welcome to Nestfolio',
        body: 'Your account setup is complete. You can now start investing.',
        channel: 'email',
      },
      MANDATE_GRANTED: {
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
    };

    return contentMap[eventType] ?? {
      title: 'Notification',
      body: `Event ${eventType} occurred.`,
      channel: 'push',
    };
  }

  private getCurrentPeriod(): string {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }
}
