import { util } from '@aws-appsync/utils';

export function request(ctx) {
  const tenantId = ctx.identity?.claims?.['custom:tenant_id'];
  if (!tenantId) {
    util.unauthorized();
  }
  return {
    operation: 'GetItem',
    key: util.dynamodb.toMapValues({
      pk: `T#${tenantId}`,
      sk: 'AdvisoryStatus',
    }),
  };
}

export function response(ctx) {
  if (ctx.error) util.error(ctx.error.message, ctx.error.type);
  if (!ctx.result) return null;
  return {
    tenantId: ctx.result.pk?.startsWith('T#') ? ctx.result.pk.slice(2) : ctx.result.pk,
    inFlightCount: ctx.result.inFlightCount ?? 0,
    lastTriggerAt: ctx.result.lastTriggerAt ?? null,
    updatedAt: ctx.result.updatedAt,
  };
}
