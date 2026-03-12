import { util } from '@aws-appsync/utils';
import * as ddb from '@aws-appsync/utils/dynamodb';

export function request(ctx) {
  const { tenantId } = ctx.stash;
  const streamType = (ctx.arguments.streamType || '').toLowerCase();
  if (streamType !== 'actual' && streamType !== 'simulated') {
    util.error('streamType must be ACTUAL or SIMULATED', 'ValidationError');
  }
  ctx.stash.streamType = streamType;
  return ddb.get({
    key: { pk: `Portfolio#${tenantId}#${streamType}`, sk: 'PortfolioSnapshot' },
  });
}

export function response(ctx) {
  if (ctx.error) util.error(ctx.error.message, ctx.error.type);
  const { streamType } = ctx.stash;
  if (!ctx.result) {
    ctx.stash.snapshot = {
      cashBalanceCents: 10000000,
      totalValueCents: 10000000,
      positionCount: 0,
      snapshotAt: util.time.nowISO8601(),
      streamType: streamType.toUpperCase(),
    };
  } else {
    ctx.stash.snapshot = {
      cashBalanceCents: ctx.result.cashBalanceCents,
      totalValueCents: ctx.result.totalValueCents,
      positionCount: ctx.result.positionCount,
      snapshotAt: ctx.result.snapshotAt,
      streamType: streamType.toUpperCase(),
    };
  }
  return ctx.stash.snapshot;
}
