import { util } from '@aws-appsync/utils';
import { computeRiskProfile } from '../../domain/risk-profile.service';

export function request(ctx: any) {
  const { tenantId, userId } = ctx.stash;
  const { toleranceIdx, experienceIdx } = ctx.arguments;
  const now = util.time.nowISO8601();
  const r = computeRiskProfile(toleranceIdx, experienceIdx);
  // Map computeRiskProfile's `tolerance` field → `toleranceResponse` to match
  // the GraphQL RiskProfile type (toleranceResponse: String!) and DDB storage shape.
  const riskProfile = {
    score: r.score,
    band: r.band,
    toleranceResponse: r.tolerance,
    experienceLevel: r.experienceLevel,
  };
  return {
    operation: 'UpdateItem',
    key: util.dynamodb.toMapValues({ pk: `InvestorProfile#${tenantId}#${userId}`, sk: 'InvestorProfile' }),
    update: {
      expression: 'SET riskProfile = :rp, updatedAt = :now, #ts = :now, #v = if_not_exists(#v, :zero) + :one',
      expressionNames: { '#ts': 'timestamp', '#v': '__version' },
      expressionValues: util.dynamodb.toMapValues({ ':rp': riskProfile, ':now': now, ':zero': 0, ':one': 1 }),
    },
    condition: { expression: 'attribute_exists(pk)' },
  };
}

export function response(ctx: any) {
  if (ctx.error) util.error(ctx.error.message, ctx.error.type);
  return ctx.result;
}
