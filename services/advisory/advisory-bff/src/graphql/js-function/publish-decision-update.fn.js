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
  // Provide schema-required defaults for fields that are non-null in
  // DecisionPacket but not arguments to publishDecisionUpdate (e.g.,
  // confirmationRequired, complianceChecks, agentInvocations, trigger,
  // createdAt). The subscriber doesn't depend on these for filtering or
  // for the version-guarded store update — they're carried for type safety.
  const args = ctx.arguments;
  return {
    decisionId: args.decisionId,
    tenantId: args.tenantId,
    status: args.status,
    explanation: args.explanation,
    proposedTrades: args.proposedTrades,
    version: args.version,
    updatedAt: args.updatedAt,
    trigger: 'BROADCAST',
    confirmationRequired: false,
    complianceChecks: [],
    agentInvocations: [],
    confirmedAt: null,
    rejectedAt: null,
    rejectionReason: null,
    createdAt: args.updatedAt,
  };
}
