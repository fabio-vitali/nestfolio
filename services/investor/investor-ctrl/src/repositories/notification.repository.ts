import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { TableRepository, getUUID, getTime, type TableEntry } from '@nestfolio/event-processor';
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
      tenantId: string,
      notificationId: string,
      data: Record<string, unknown>,
    ): Promise<boolean> => {
      const now = getTime();
      const item: TableEntry = {
        pk: notificationPk(tenantId, notificationId),
        sk: 'Notification',
        __typename: 'Notification',
        tenantId,
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

      const editEvent: TableEntry = {
        pk,
        sk: `EditEvent#${now}#${getUUID()}`,
        __typename: 'EditEvent',
        tenantId,
        timestamp: now,
        operation: 'replace',
        path: `/notification/${notificationId}/status`,
        value: { status, ...(details ?? {}) },
        editedBy: 'system',
        editedAt: now,
      };

      await this.transactWrite({
        TransactItems: [
          this.buildTransactUpdate(pk, 'Notification', {
            status,
            updatedAt: now,
            timestamp: now,
            ...(details ?? {}),
          }) as any,
          { Put: { TableName: this.tableName, Item: editEvent } },
        ],
      });
    },
  );

  readonly createMonthlyReport = this.log('createMonthlyReport',
    async (
      tenantId: string,
      reportId: string,
      data: Record<string, unknown>,
    ): Promise<boolean> => {
      const now = getTime();
      const item: TableEntry = {
        pk: monthlyReportPk(tenantId, reportId),
        sk: 'MonthlyReport',
        __typename: 'MonthlyReport',
        tenantId,
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
