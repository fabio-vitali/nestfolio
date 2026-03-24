import { util } from '@aws-appsync/utils';

export function request(ctx) {
  const tenantId = ctx.identity?.claims?.['custom:tenantId'];
  const userId = ctx.identity?.claims?.['sub'];
  if (!tenantId || !userId) { util.unauthorized(); }
  ctx.stash.tenantId = tenantId;
  ctx.stash.userId = userId;
  ctx.stash.region = ctx.env?.AWS_REGION ?? 'us-east-1';
  return {};
}

export function response(ctx) { return ctx.prev.result; }
