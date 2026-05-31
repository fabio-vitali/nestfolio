import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { GetCommand } from '@aws-sdk/lib-dynamodb';
import { TableRepository, withMethodLogging } from '@nestfolio/event-processor';

export interface FundingCarrierRow {
  transferId: string;
  amountCents: number;
  currency: string;
  initiatedAt: string;
  userId: string;
}

export class FundingRepository extends TableRepository {
  private readonly log = withMethodLogging('FundingRepository');

  constructor(tableName: string, client?: DynamoDBClient) {
    super(tableName, client);
  }

  /** Read the requested carrier (sk = the requested event name) for carry-forward. */
  readonly getRequested = this.log(
    'getRequested',
    async (
      tenantId: string,
      transferId: string,
      requestedEventName: string,
    ): Promise<FundingCarrierRow | undefined> => {
      const result = await this.docClient.send(
        new GetCommand({
          TableName: this.tableName,
          Key: { pk: `Funding#${tenantId}#${transferId}`, sk: requestedEventName },
        }),
      );
      return result.Item as FundingCarrierRow | undefined;
    },
  );
}
