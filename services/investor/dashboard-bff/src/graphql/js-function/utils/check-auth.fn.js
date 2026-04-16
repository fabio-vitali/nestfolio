import { util } from '@aws-appsync/utils';

export function request(ctx) {
  // IAM-authenticated requests (Lambda→AppSync) have accountId, not claims
  if (ctx.identity?.accountId) {
    ctx.stash.authMode = 'iam';
    ctx.stash.region = ctx.env?.AWS_REGION ?? 'us-east-1';
    return {};
  }
  // Cognito-authenticated requests (user→AppSync)
  const tenantId = ctx.identity?.claims?.['custom:tenant_id'];
  const userId = ctx.identity?.claims?.['sub'];
  if (!tenantId || !userId) { util.unauthorized(); }
  ctx.stash.tenantId = tenantId;
  ctx.stash.userId = userId;
  ctx.stash.region = ctx.env?.AWS_REGION ?? 'us-east-1';
  return {};
}

export function response(ctx) { return ctx.prev.result; }
