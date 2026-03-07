import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  GetCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { TableRepository, getUUID, getTime, log, type TableEntry } from '@nestfolio/platform-core';

function portfolioPk(tenantId: string, portfolioId: string): string {
  return `Portfolio#${tenantId}#${portfolioId}`;
}

export class PortfolioRepository extends TableRepository {
  constructor(tableName: string, client?: DynamoDBClient) {
    super(tableName, client);
  }

  @log()
  async getOrCreatePortfolio(tenantId: string, portfolioId: string): Promise<Record<string, unknown>> {
    const pk = portfolioPk(tenantId, portfolioId);
    const result = await this.docClient.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { pk, sk: 'Portfolio' },
      }),
    );

    if (result.Item) {
      return result.Item;
    }

    const now = getTime();
    const item: TableEntry = {
      pk,
      sk: 'Portfolio',
      __typename: 'Portfolio',
      tenantId,
      timestamp: now,
      portfolioId,
      totalValue: 0,
      cashBalance: 0,
      positionCount: 0,
      currency: 'USD',
      createdAt: now,
      updatedAt: now,
    };

    await this.put(item);
    return item;
  }

  @log()
  async updatePortfolio(
    tenantId: string,
    portfolioId: string,
    updates: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const pk = portfolioPk(tenantId, portfolioId);
    const now = getTime();

    const updateExpressions: string[] = ['#ts = :ts', 'updatedAt = :now'];
    const expressionNames: Record<string, string> = { '#ts': 'timestamp' };
    const expressionValues: Record<string, unknown> = { ':ts': now, ':now': now };

    for (const [key, value] of Object.entries(updates)) {
      if (value !== undefined) {
        updateExpressions.push(`#${key} = :${key}`);
        expressionNames[`#${key}`] = key;
        expressionValues[`:${key}`] = value;
      }
    }

    const result = await this.docClient.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { pk, sk: 'Portfolio' },
        UpdateExpression: `SET ${updateExpressions.join(', ')}`,
        ExpressionAttributeNames: expressionNames,
        ExpressionAttributeValues: expressionValues,
        ReturnValues: 'ALL_NEW',
      }),
    );

    return result.Attributes ?? {};
  }

  @log()
  async upsertPosition(
    tenantId: string,
    portfolioId: string,
    instrument: string,
    quantity: number,
    avgCost: number,
    currentPrice: number,
  ): Promise<Record<string, unknown>> {
    const pk = portfolioPk(tenantId, portfolioId);
    const now = getTime();
    const marketValue = quantity * currentPrice;
    const unrealizedPnl = (currentPrice - avgCost) * quantity;
    const unrealizedPnlPercent = avgCost !== 0 ? ((currentPrice - avgCost) / avgCost) * 100 : 0;

    const item: TableEntry = {
      pk,
      sk: `Position#${instrument}`,
      __typename: 'Position',
      tenantId,
      timestamp: now,
      instrument,
      quantity,
      avgCostBasis: avgCost,
      currentPrice,
      marketValue,
      unrealizedPnl,
      unrealizedPnlPercent,
      updatedAt: now,
    };

    const editEvent: TableEntry = {
      pk,
      sk: `EditEvent#${now}#${getUUID()}`,
      __typename: 'EditEvent',
      tenantId,
      timestamp: now,
      operation: 'replace',
      path: `/positions/${instrument}`,
      value: { instrument, quantity, avgCost, currentPrice },
      editedBy: 'system',
      editedAt: now,
    };

    await this.transactWrite({
      TransactItems: [
        { Put: { TableName: this.tableName, Item: item } },
        { Put: { TableName: this.tableName, Item: editEvent } },
      ],
    });

    return item;
  }

  @log()
  async getPosition(
    tenantId: string,
    portfolioId: string,
    instrument: string,
  ): Promise<Record<string, unknown> | null> {
    const pk = portfolioPk(tenantId, portfolioId);
    const result = await this.docClient.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { pk, sk: `Position#${instrument}` },
      }),
    );
    return result.Item ?? null;
  }

  @log()
  async getAllPositions(tenantId: string, portfolioId: string): Promise<Record<string, unknown>[]> {
    const pk = portfolioPk(tenantId, portfolioId);
    return this.queryByPk(pk, 'Position#');
  }

  @log()
  async updateCashBalance(
    tenantId: string,
    portfolioId: string,
    currency: string,
    amount: number,
  ): Promise<Record<string, unknown>> {
    const pk = portfolioPk(tenantId, portfolioId);
    const now = getTime();

    const item: TableEntry = {
      pk,
      sk: `CashBalance#${currency}`,
      __typename: 'CashBalance',
      tenantId,
      timestamp: now,
      currency,
      amount,
      updatedAt: now,
    };

    await this.put(item);
    return item;
  }

  @log()
  async getCashBalance(
    tenantId: string,
    portfolioId: string,
    currency: string,
  ): Promise<Record<string, unknown> | null> {
    const pk = portfolioPk(tenantId, portfolioId);
    const result = await this.docClient.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { pk, sk: `CashBalance#${currency}` },
      }),
    );
    return result.Item ?? null;
  }

  @log()
  async putPerformanceMetric(
    tenantId: string,
    portfolioId: string,
    period: string,
    metric: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const pk = portfolioPk(tenantId, portfolioId);
    const now = getTime();

    const item: TableEntry = {
      pk,
      sk: `Performance#${period}`,
      __typename: 'PerformanceMetric',
      tenantId,
      timestamp: now,
      period,
      ...metric,
      updatedAt: now,
    };

    await this.put(item);
    return item;
  }
}
