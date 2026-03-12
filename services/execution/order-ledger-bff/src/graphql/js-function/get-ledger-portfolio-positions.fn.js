import { util } from '@aws-appsync/utils';
import * as ddb from '@aws-appsync/utils/dynamodb';

export function request(ctx) {
  const { tenantId, streamType } = ctx.stash;
  return ddb.query({
    query: {
      pk: { eq: `Portfolio#${tenantId}#${streamType}` },
      sk: { beginsWith: 'Position#' },
    },
  });
}

export function response(ctx) {
  if (ctx.error) util.error(ctx.error.message, ctx.error.type);
  const positions = ctx.result.items || [];
  const snapshot = ctx.stash.snapshot;
  return {
    positions,
    cashBalanceCents: snapshot.cashBalanceCents,
    totalValueCents: snapshot.totalValueCents,
    positionCount: snapshot.positionCount,
    snapshotAt: snapshot.snapshotAt,
    streamType: snapshot.streamType,
  };
}
