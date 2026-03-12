import { util } from '@aws-appsync/utils';

export function request(ctx) {
  const tenantId = ctx.identity?.claims?.['custom:tenantId'];
  const username = ctx.identity?.username;

  if (!tenantId || !username) {
    util.unauthorized();
  }

  const userId = username.split('@')[0];
  ctx.stash.tenantId = tenantId;
  ctx.stash.userId = userId;
  return {};
}

export function response(ctx) {
  return ctx.prev.result;
}
