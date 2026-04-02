import { logger, type BusEvent } from '@nestfolio/event-processor';
import { withMethodLogging } from '@nestfolio/event-processor';
import { NotificationRepository } from '../repositories/notification.repository';
import { NotificationDeliveryService, type DeliveryResult } from './notification-delivery.service';

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

  constructor(
    private readonly repository: NotificationRepository,
    private readonly delivery: NotificationDeliveryService,
  ) {}

  readonly executeNotificationLifecycle = this.log('executeNotificationLifecycle',
    async (context: NotificationContext): Promise<NotificationResult> => {
      const notificationId = context.triggerEvent.id;
      const content = this.getNotificationContent(context.triggerEvent.type);

      // 1. Create notification (conditional write — returns false if already exists)
      const created = await this.repository.createNotification(context.tenantId, notificationId, {
        title: content.title,
        body: content.body,
        channel: content.channel,
        triggerEventType: context.triggerEvent.type,
        sourceEventId: context.triggerEvent.id,
      });

      if (!created) {
        logger.info('Notification already exists, skipping duplicate', {
          tenantId: context.tenantId,
          notificationId,
        });
        return { notificationId, status: 'COMPLETED' };
      }

      // 2. Dispatch to channel
      const deliveryResult = await this.dispatchToChannel(content.channel, {
        title: content.title,
        body: content.body,
      });

      // 3. Update status based on delivery result
      if (deliveryResult.delivered) {
        await this.repository.updateNotificationStatus(
          context.tenantId, notificationId, 'DELIVERED',
          { deliveredAt: deliveryResult.timestamp },
        );
      } else {
        await this.repository.updateNotificationStatus(
          context.tenantId, notificationId, 'FAILED',
          { failedAt: deliveryResult.timestamp, failureReason: deliveryResult.error },
        );
      }

      // 4. For ORDER_FILLED events, also create monthly report
      if (context.triggerEvent.type === 'ORDER_FILLED') {
        const reportId = context.triggerEvent.id + '-report';
        const subject = (context.triggerEvent.subject as Record<string, unknown>) ?? {};
        const reportCreated = await this.repository.createMonthlyReport(context.tenantId, reportId, {
          period: this.getCurrentPeriod(),
          orderDetails: subject,
          sourceEventId: context.triggerEvent.id,
          status: 'GENERATED',
        });

        if (reportCreated) {
          logger.info('Monthly report generated for ORDER_FILLED', {
            tenantId: context.tenantId,
            reportId,
          });
        }
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

  private async dispatchToChannel(
    channel: string,
    notification: { title: string; body: string },
  ): Promise<DeliveryResult> {
    switch (channel) {
      case 'push':
        return this.delivery.deliverPush(notification, 'default-token');
      case 'email':
        return this.delivery.deliverEmail(notification, 'default@nestfolio.dev');
      default:
        // IN_APP: no external dispatch needed
        return { delivered: true, channel: 'IN_APP', timestamp: new Date().toISOString() };
    }
  }

  private getNotificationContent(eventType: string): NotificationContent {
    const contentMap: Record<string, NotificationContent> = {
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
