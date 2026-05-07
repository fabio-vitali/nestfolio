// IAM-only echo resolver. No DDB access — this mutation is a pure broadcast
// vehicle for the @aws_subscribe filter on onDecisionUpdate. AppSync's
// filter-arg matching compares the subscriber's tenantId argument against
// fields in the mutation RESPONSE — so this resolver echoes ALL arguments
// back unchanged to make the response carry tenantId (and every other field
// the client fragment selects).
//
// Schema: see services/advisory/advisory-bff/src/schema.graphql — the
// mutation is annotated @aws_iam, so only the DecisionPublisher Lambda can
// invoke it via SigV4-signed POST.
export function request(_ctx) {
  return { payload: null };
}

export function response(ctx) {
  // Echo args back. Optional fields (confirmationRequired/confirmedAt/
  // rejectedAt/rejectionReason) carry the live row state from the publisher's
  // mapImage; without them, a mid-cycle frame would erase those values at the
  // subscriber's full-replace store. complianceChecks/agentInvocations are
  // schema-required arrays the publisher doesn't carry — defaulted to [] so
  // the subscriber's getDecision query is the sole source of truth for those.
  const args = ctx.arguments;
  return {
    decisionId: args.decisionId,
    tenantId: args.tenantId,
    status: args.status,
    trigger: args.trigger,
    explanation: args.explanation,
    proposedTrades: args.proposedTrades,
    version: args.version,
    createdAt: args.createdAt,
    updatedAt: args.updatedAt,
    confirmationRequired: args.confirmationRequired ?? false,
    confirmedAt: args.confirmedAt ?? null,
    rejectedAt: args.rejectedAt ?? null,
    rejectionReason: args.rejectionReason ?? null,
    complianceChecks: [],
    agentInvocations: [],
  };
}
