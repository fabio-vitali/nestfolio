import { util } from '@aws-appsync/utils';

export function request(ctx) {
  const { tenantId, userId, region } = ctx.stash;
  const { decisionId, reason } = ctx.arguments;

  if (!decisionId || decisionId.length === 0) {
    util.error('decisionId is required', 'ValidationError');
  }
  if (decisionId.length > 256) {
    util.error('decisionId must be 256 characters or less', 'ValidationError');
  }
  if (!reason || reason.length === 0) {
    util.error('reason is required', 'ValidationError');
  }
  if (reason.length > 2000) {
    util.error('reason must be 2000 characters or less', 'ValidationError');
  }

  // get-decision-readback pre-step has placed the existing DecisionReadModel
  // in ctx.prev.result. Lift taskToken onto the UserRejection intent row so CDC
  // re-emits USER_REJECTED with subject.taskToken and the SF can resume.
  //
  // This resolver writes ONLY the UserRejection intent row. It no longer
  // echoes status onto the DecisionReadModel projection row — that row is a
  // P1 projection whose sole writer is projectVersioned. The terminal status
  // arrives via the versioned projection after the SF resumes and DWC updates
  // the DecisionPacket. The MFE reflects the action optimistically (see
  // advisory-mfe).
  const taskToken = ctx.prev?.result?.taskToken;

  const now = util.time.nowISO8601();
  const pk = `Decision#${tenantId}#${decisionId}`;

  const userRejectionAttrs = {
    __typename: 'UserRejection',
    tenantId,
    region,
    decisionId,
    rejectedAt: now,
    rejectedBy: userId,
    rejectionReason: reason,
    timestamp: now,
  };
  if (taskToken) {
    userRejectionAttrs.taskToken = taskToken;
  }

  return {
    operation: 'PutItem',
    key: util.dynamodb.toMapValues({ pk, sk: `UserRejection#${util.autoId()}` }),
    attributeValues: util.dynamodb.toMapValues(userRejectionAttrs),
  };
}

export function response(ctx) {
  if (ctx.error) util.error(ctx.error.message, ctx.error.type);
  ctx.stash.decisionId = ctx.arguments.decisionId;
  return ctx.prev.result;
}
