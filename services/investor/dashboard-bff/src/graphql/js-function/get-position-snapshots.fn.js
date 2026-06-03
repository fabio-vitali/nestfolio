import { util } from '@aws-appsync/utils';
import * as ddb from '@aws-appsync/utils/dynamodb';

export function request(ctx) {
  const { tenantId } = ctx.stash;
  return ddb.query({
    query: {
      pk: { eq: `T#${tenantId}` },
      sk: { beginsWith: 'PositionSnapshot#' },
    },
  });
}

export function response(ctx) {
  if (ctx.error) util.error(ctx.error.message, ctx.error.type);
  // Fully-exited symbols persist as version-correct quantity:0 PositionSnapshot
  // rows; holdings are quantity > 0. Filter the ghost rows at the read boundary.
  const items = ctx.result.items || [];
  return items.filter((p) => (p.quantity ?? 0) > 0);
}
