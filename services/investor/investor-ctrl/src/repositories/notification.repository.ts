import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { TableRepository, getTime, type TableEntry, type RequestContext } from '@nestfolio/event-processor';
import { withMethodLogging } from '@nestfolio/event-processor';

function notificationPk(tenantId: string, notificationId: string): string {
  return `Notification#${tenantId}#${notificationId}`;
}

function monthlyReportPk(tenantId: string, reportId: string): string {
  return `MonthlyReport#${tenantId}#${reportId}`;
}

export class NotificationRepository extends TableRepository {
  private readonly log = withMethodLogging('NotificationRepository');

  constructor(tableName: string, client?: DynamoDBClient) {
    super(tableName, client);
  }

  readonly createNotification = this.log('createNotification',
    async (
      notificationId: string,
      data: Record<string, unknown>,
      ctx: RequestContext,
    ): Promise<boolean> => {
      const now = getTime();
      const item: TableEntry = {
        pk: notificationPk(ctx.tenantId, notificationId),
        sk: 'Notification',
        __typename: 'Notification',
        ...ctx,
        timestamp: now,
        notificationId,
        status: 'CREATED',
        ...data,
        createdAt: now,
        updatedAt: now,
        version: 1,
      };
      return this.putIfNotExists(item);
    },
  );

  readonly updateNotificationStatus = this.log('updateNotificationStatus',
    async (
      tenantId: string,
      notificationId: string,
      status: string,
      details?: Record<string, unknown>,
    ): Promise<void> => {
      const pk = notificationPk(tenantId, notificationId);
      const now = getTime();

      await this.transactWrite({
        TransactItems: [
          this.buildTransactUpdate(pk, 'Notification', {
            status,
            updatedAt: now,
            timestamp: now,
            ...(details ?? {}),
          }) as any,
        ],
      });
    },
  );

  readonly createMonthlyReport = this.log('createMonthlyReport',
    async (
      reportId: string,
      data: Record<string, unknown>,
      ctx: RequestContext,
    ): Promise<boolean> => {
      const now = getTime();
      const item: TableEntry = {
        pk: monthlyReportPk(ctx.tenantId, reportId),
        sk: 'MonthlyReport',
        __typename: 'MonthlyReport',
        ...ctx,
        timestamp: now,
        reportId,
        ...data,
        createdAt: now,
        updatedAt: now,
        version: 1,
      };
      return this.putIfNotExists(item);
    },
  );
}
