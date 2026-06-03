import { util } from '@aws-appsync/utils';

const VALID_MODES = ['CONSERVATIVE', 'BALANCED', 'AGGRESSIVE'];

export function request(ctx) {
  const { tenantId, userId, tableName } = ctx.stash;
  const mode = ctx.arguments.mode;
  if (!VALID_MODES.includes(mode)) {
    util.error(`Invalid operatingMode: ${mode}`, 'ValidationError');
  }
  const now = util.time.nowISO8601();
  const pk = `InvestorProfile#${tenantId}#${userId}`;
  const update = {
    expression: 'SET operatingMode = :mode, updatedAt = :now, #ts = :now, #v = if_not_exists(#v, :zero) + :one',
    expressionNames: { '#ts': 'timestamp', '#v': '__version' },
    expressionValues: util.dynamodb.toMapValues({ ':mode': mode, ':now': now, ':zero': 0, ':one': 1 }),
  };
  return {
    operation: 'TransactWriteItems',
    transactItems: [
      // InvestorProfile composite row — bumps its own __version so dashboard-bff's
      // InvestorSnapshot keeps its version line and INVESTOR_PROFILE_UPDATED keeps firing.
      {
        table: tableName,
        operation: 'UpdateItem',
        key: util.dynamodb.toMapValues({ pk, sk: 'InvestorProfile' }),
        update,
        condition: { expression: 'attribute_exists(pk)' },
      },
      // Mandate sibling row — bumps the Mandate __version so OPERATING_MODE_CHANGED
      // (re-sourced from this row's CDC) carries the full Mandate image on one
      // monotonic line. Guarded to an ACTIVE mandate.
      {
        table: tableName,
        operation: 'UpdateItem',
        key: util.dynamodb.toMapValues({ pk, sk: 'Mandate' }),
        update,
        condition: {
          expression: 'attribute_exists(pk) AND #status = :active',
          expressionNames: { '#status': 'status' },
          expressionValues: util.dynamodb.toMapValues({ ':active': 'ACTIVE' }),
        },
      },
    ],
  };
}

export function response(ctx) {
  if (ctx.error) {
    if (ctx.error.type === 'DynamoDB:TransactionCanceledException') {
      util.error('Cannot change operating mode (mandate inactive or profile missing)', 'InvalidState');
    }
    util.error(ctx.error.message, ctx.error.type);
  }
  // TransactWriteItems returns no attributes; the InvestorProfile is read back by
  // a get-profile.fn.js readback step appended via extraSteps (next task).
  return ctx.result;
}
