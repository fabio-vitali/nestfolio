import { util } from '@aws-appsync/utils';
import * as ddb from '@aws-appsync/utils/dynamodb';

export function request(ctx) {
  const { tenantId } = ctx.stash;
  const streamType = (ctx.arguments.streamType || '').toLowerCase();
  if (streamType !== 'actual' && streamType !== 'simulated') {
    util.error('streamType must be ACTUAL or SIMULATED', 'ValidationError');
  }
  const limit = ctx.arguments?.limit ?? 20;
  if (limit < 1 || limit > 100) {
    util.error('limit must be between 1 and 100', 'ValidationError');
  }
  const orderId = ctx.arguments?.orderId;

  if (orderId) {
    // Specific order: query by pk
    return {
      operation: 'Query',
      query: {
        expression: 'pk = :pk AND begins_with(sk, :sk)',
        expressionValues: util.dynamodb.toMapValues({
          ':pk': `OrderStream#${tenantId}#${streamType}#${orderId}`,
          ':sk': 'Event#',
        }),
      },
      limit,
      scanIndexForward: false,
      ...(ctx.arguments?.cursor && { nextToken: ctx.arguments.cursor }),
    };
  }

  // All orders: query GSI
  return {
    operation: 'Query',
    index: 'tenantId-index',
    query: {
      expression: 'tenantId = :tenantId',
      expressionValues: util.dynamodb.toMapValues({ ':tenantId': tenantId }),
    },
    filter: {
      expression: '#st = :streamType AND #tn = :typename',
      expressionNames: { '#st': 'streamType', '#tn': '__typename' },
      expressionValues: util.dynamodb.toMapValues({
        ':streamType': streamType,
        ':typename': 'LedgerEntry',
      }),
    },
    limit,
    scanIndexForward: false,
    ...(ctx.arguments?.cursor && { nextToken: ctx.arguments.cursor }),
  };
}

export function response(ctx) {
  if (ctx.error) util.error(ctx.error.message, ctx.error.type);
  const items = ctx.result.items || [];
  return {
    entries: items,
    nextCursor: ctx.result.nextToken || null,
    hasMore: !!ctx.result.nextToken,
  };
}
