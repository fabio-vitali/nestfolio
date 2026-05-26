import { DynamoDBClient, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import type { TestContext } from '@nestfolio/test-support';
import type { FreshTenant } from '@nestfolio/e2e-feature-tests';

const POLL_INTERVAL_MS = 2_000;

interface Options {
  timeoutMs?: number;
}

/**
 * Poll the DWC state table until a `LedgerSnapshot` row exists for the
 * given tenant (i.e., the SnapshotProjectorIngress has materialised the
 * PORTFOLIO_UPDATED event into DDB).
 *
 * The row key mirrors what decision-state-machine.ts reads in the
 * LookupLedgerSnapshot SF step:
 *   pk = `LedgerSnapshot#${tenantId}`
 *   sk = `LedgerSnapshot`
 *
 * Uses `ctx.ssm.tableName('decision-workflow-ctrl')` for table discovery —
 * matching the pattern used by TableAssertions in the integration-testing lib.
 */
export async function waitForLedgerSnapshotRow(
  ctx: TestContext,
  tenant: FreshTenant,
  options: Options = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 60_000;
  const deadline = Date.now() + timeoutMs;

  const tableName = await ctx.ssm.tableName('decision-workflow-ctrl');
  const client = new DynamoDBClient({ region: ctx.region });

  try {
    while (Date.now() < deadline) {
      const result = await client.send(
        new GetItemCommand({
          TableName: tableName,
          Key: marshall({
            pk: `LedgerSnapshot#${tenant.tenantId}`,
            sk: 'LedgerSnapshot',
          }),
        }),
      );

      if (result.Item) {
        const item = unmarshall(result.Item);
        if (item['state']) return;
      }

      await new Promise<void>((r) => setTimeout(r, POLL_INTERVAL_MS));
    }
  } finally {
    client.destroy();
  }

  throw new Error(
    `waitForLedgerSnapshotRow: no row for tenant=${tenant.tenantId} after ${timeoutMs}ms`,
  );
}
