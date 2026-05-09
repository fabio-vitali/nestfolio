// IAM-only echo resolver. No DDB access — this mutation is a pure broadcast
// vehicle for the @aws_subscribe filter on onAdvisoryStatusUpdate. AppSync's
// filter-arg matching compares the subscriber's tenantId argument against
// fields in the mutation RESPONSE — so this resolver echoes ALL arguments
// back unchanged to make the response carry tenantId (and every other field
// the client fragment selects).
//
// Schema: see services/advisory/advisory-bff/src/schema.graphql — the
// mutation is annotated @aws_iam, so only the advisory-status-publisher
// Lambda can invoke it via SigV4-signed POST.
export function request(_ctx) {
  return { payload: null };
}

export function response(ctx) {
  const args = ctx.arguments;
  return {
    tenantId: args.tenantId,
    inFlightCount: args.inFlightCount,
    lastTriggerAt: args.lastTriggerAt ?? null,
    updatedAt: args.updatedAt,
  };
}
