import { util } from '@aws-appsync/utils';
import * as ddb from '@aws-appsync/utils/dynamodb';

export function request(ctx) {
  const { tenantId, userId } = ctx.stash;
  const pk = `InvestorProfile#${tenantId}#${userId}`;
  return ddb.batchGet({
    tables: {
      [ctx.stash.tableName]: {
        keys: [
          { pk, sk: 'InvestorProfile' },
          { pk, sk: 'MandateStatus' },
        ],
      },
    },
  });
}

export function response(ctx) {
  if (ctx.error) util.error(ctx.error.message, ctx.error.type);
  const items = (ctx.result && ctx.result.data && ctx.result.data[ctx.stash.tableName]) || [];
  let profile = null;
  let mandateStatus = null;
  for (const item of items) {
    if (!item) continue;
    if (item.sk === 'InvestorProfile') profile = item;
    else if (item.sk === 'MandateStatus') mandateStatus = item;
  }
  if (!profile) util.error('Profile not found', 'NotFound');
  if (mandateStatus && profile.mandate) {
    profile.mandate.status = mandateStatus.status;
    profile.mandate.revokedAt = mandateStatus.revokedAt;
  }
  return profile;
}
