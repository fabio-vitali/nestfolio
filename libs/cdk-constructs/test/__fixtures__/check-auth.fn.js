import { util } from '@aws-appsync/utils';
export function request(ctx) {
  const tenantId = ctx.identity?.claims?.['custom:tenantId'];
  const userId = ctx.identity?.username;
  if (!tenantId || !userId) util.unauthorized();
  ctx.stash.tenantId = tenantId;
  ctx.stash.userId = userId;
  return {};
}
export function response(ctx) { return ctx.prev.result; }
