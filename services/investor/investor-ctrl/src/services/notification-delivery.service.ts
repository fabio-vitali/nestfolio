import { logger } from '@nestfolio/event-processor';
import { withMethodLogging } from '@nestfolio/event-processor';

export interface DeliveryResult {
  delivered: boolean;
  channel: string;
  timestamp: string;
  error?: string;
}

export class NotificationDeliveryService {
  private readonly log = withMethodLogging('NotificationDeliveryService');

  readonly deliverPush = this.log('deliverPush',
    async (notification: {
      title: string;
      body: string;
    }, _deviceToken: string): Promise<DeliveryResult> => {
      // In production: SNS publish to device topic
      logger.info('Push notification dispatched', { title: notification.title });
      return {
        delivered: true,
        channel: 'PUSH',
        timestamp: new Date().toISOString(),
      };
    },
  );

  readonly deliverEmail = this.log('deliverEmail',
    async (notification: {
      title: string;
      body: string;
    }, _email: string): Promise<DeliveryResult> => {
      // In production: SES send with template
      logger.info('Email notification dispatched', { title: notification.title });
      return {
        delivered: true,
        channel: 'EMAIL',
        timestamp: new Date().toISOString(),
      };
    },
  );
}
