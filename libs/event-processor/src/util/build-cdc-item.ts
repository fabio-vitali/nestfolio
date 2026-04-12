import type { RequestContext } from '../domain/schemas';

/**
 * Build a DDB item with the required CDC context fields.
 *
 * Use this when writing DDB items via raw PutCommand (bypassing the
 * event-processor intent system) that are read by DynamoDB Streams CDC.
 * The CDC handler reads `tenantId`, `userId`, and `region` from the
 * DDB record to construct the event envelope — items missing these
 * fields produce events rejected by downstream `parse-sqs-record`.
 *
 * For handlers using the intent system (record/project/update), these
 * fields are injected automatically by `pickRequestContext(ctx)` in
 * intent-executor.ts — this helper is NOT needed there.
 */
export function buildCdcItem(
  typename: string,
  keys: { pk: string; sk: string },
  ctx: RequestContext,
  fields: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...keys,
    __typename: typename,
    tenantId: ctx.tenantId,
    userId: ctx.userId,
    region: ctx.region,
    ...fields,
  };
}
