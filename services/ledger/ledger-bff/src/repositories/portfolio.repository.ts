import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { TableRepository, withMethodLogging } from '@nestfolio/event-processor';

export class PortfolioRepository extends TableRepository {
  private readonly log = withMethodLogging('PortfolioRepository');

  constructor(tableName: string, client?: DynamoDBClient) {
    super(tableName, client);
  }

  // --- Read operations (the only live surface; writes are owned by the
  //     materializeToTable transform pipeline, not this repository) ---

  readonly getLatest = this.log('getLatest',
    async (tenantId: string): Promise<Record<string, unknown> | null> => {
      const result = await this.docClient.send(
        new GetCommand({
          TableName: this.tableName,
          Key: { pk: `Portfolio#${tenantId}`, sk: 'Latest' },
        }),
      );
      return (result.Item as Record<string, unknown>) ?? null;
    },
  );

  readonly getPositions = this.log('getPositions',
    async (tenantId: string): Promise<Record<string, unknown>[]> => {
      return this.queryByPk(`Portfolio#${tenantId}`, 'Position#');
    },
  );

  readonly getSimulationLatest = this.log('getSimulationLatest',
    async (tenantId: string): Promise<Record<string, unknown> | null> => {
      const result = await this.docClient.send(
        new GetCommand({
          TableName: this.tableName,
          Key: { pk: `Simulation#${tenantId}`, sk: 'Latest' },
        }),
      );
      return (result.Item as Record<string, unknown>) ?? null;
    },
  );

  readonly getSimulationPositions = this.log('getSimulationPositions',
    async (tenantId: string): Promise<Record<string, unknown>[]> => {
      return this.queryByPk(`Simulation#${tenantId}`, 'Position#');
    },
  );

  readonly getSnapshotAt = this.log('getSnapshotAt',
    async (tenantId: string, timestamp: string): Promise<Record<string, unknown> | null> => {
      const result = await this.docClient.send(
        new QueryCommand({
          TableName: this.tableName,
          KeyConditionExpression: 'pk = :pk AND sk <= :ts',
          ExpressionAttributeValues: {
            ':pk': `SnapshotAt#${tenantId}#actual`,
            ':ts': timestamp,
          },
          ScanIndexForward: false,
          Limit: 1,
        }),
      );
      const items = result.Items ?? [];
      return items.length > 0 ? (items[0] as Record<string, unknown>) : null;
    },
  );
}
