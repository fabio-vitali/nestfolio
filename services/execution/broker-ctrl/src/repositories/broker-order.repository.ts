import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { GetCommand } from '@aws-sdk/lib-dynamodb';
import { TableRepository, getTime, withMethodLogging } from '@nestfolio/event-processor';

export interface CreateOrderParams {
  tenantId: string;
  orderId: string;
  executionMode: string;
  routedTo: string;
  requestedQty: number;
  instrumentId: string;
  fillTaskToken: string;
}

export class BrokerOrderRepository extends TableRepository {
  private readonly log = withMethodLogging('BrokerOrderRepository');

  constructor(tableName: string, client?: DynamoDBClient) {
    super(tableName, client);
  }

  readonly createOrder = this.log('createOrder',
    async (params: CreateOrderParams): Promise<void> => {
      const now = getTime();
      await this.put({
        pk: `BrokerOrder#${params.tenantId}#${params.orderId}`,
        sk: 'BrokerOrder',
        __typename: 'BrokerOrder',
        state: 'AWAITING_FILL',
        tenantId: params.tenantId,
        orderId: params.orderId,
        executionMode: params.executionMode,
        routedTo: params.routedTo,
        fillTaskToken: params.fillTaskToken,
        requestedQty: params.requestedQty,
        filledQty: 0,
        remainingQty: params.requestedQty,
        retryCount: 0,
        instrumentId: params.instrumentId,
        routedAt: now,
      });
    },
  );

  readonly updateOrderState = this.log('updateOrderState',
    async (tenantId: string, orderId: string, state: string, updates: Record<string, unknown> = {}): Promise<void> => {
      await this.update(
        `BrokerOrder#${tenantId}#${orderId}`,
        'BrokerOrder',
        { state, ...updates, updatedAt: getTime() },
      );
    },
  );

  readonly getOrder = this.log('getOrder',
    async (tenantId: string, orderId: string): Promise<Record<string, unknown> | null> => {
      const result = await this.docClient.send(
        new GetCommand({
          TableName: this.tableName,
          Key: {
            pk: `BrokerOrder#${tenantId}#${orderId}`,
            sk: 'BrokerOrder',
          },
        }),
      );
      return result.Item ?? null;
    },
  );

  readonly storeTaskToken = this.log('storeTaskToken',
    async (tenantId: string, orderId: string, taskToken: string): Promise<void> => {
      await this.update(
        `BrokerOrder#${tenantId}#${orderId}`,
        'BrokerOrder',
        { fillTaskToken: taskToken },
      );
    },
  );

  readonly getTaskToken = this.log('getTaskToken',
    async (tenantId: string, orderId: string): Promise<string | null> => {
      const order = await this.getOrder(tenantId, orderId);
      return (order?.fillTaskToken as string) ?? null;
    },
  );
}
