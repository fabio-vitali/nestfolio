import { AppSyncResolverEvent } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { logger } from '@nestfolio/platform-core';
import { requireEnv, authorizeUser, validateQueryDepth, applyMiddleware, withLambdaContext, withTiming, withErrorPublishing, EventBridgeBus } from '@nestfolio/lambda-utils';
import { AdvisoryRepository } from '../repositories/advisory.repository';
import {
  getDecision,
  getPendingDecisions,
  getDecisionHistory,
  getAgentInvocations,
  getComplianceChecks,
} from '../resolvers/decision.resolver';
import {
  confirmDecision,
  rejectDecision,
  recordExplanationView,
} from '../resolvers/confirmation.resolver';
import { DecisionIdSchema, RejectDecisionInputSchema, PaginationLimitSchema, CursorSchema } from '../validation/schemas';

export interface ResolverDeps {
  readonly repository: AdvisoryRepository;
}

export const createResolver = (deps: ResolverDeps) =>
  async (event: AppSyncResolverEvent<Record<string, unknown>>): Promise<unknown> => {
    try {
      validateQueryDepth(event.info.selectionSetGraphQL);
      const { tenantId, userId } = authorizeUser(event);
      const fieldName = event.info.fieldName;
      const args = event.arguments ?? {};

      logger.info('Resolving field', { fieldName, tenantId, userId });

      switch (fieldName) {
      // Queries
      case 'getDecision': {
        const decisionId = DecisionIdSchema.parse(args.decisionId);
        return getDecision(deps.repository, tenantId, decisionId);
      }

      case 'getPendingDecisions': {
        const limit = PaginationLimitSchema.parse(args.limit);
        const cursor = CursorSchema.parse(args.cursor);
        return getPendingDecisions(deps.repository, tenantId, limit, cursor);
      }

      case 'getDecisionHistory': {
        const limit = PaginationLimitSchema.parse(args.limit);
        const cursor = CursorSchema.parse(args.cursor);
        return getDecisionHistory(deps.repository, tenantId, limit, cursor);
      }

      case 'getAgentInvocations': {
        const decisionId = DecisionIdSchema.parse(args.decisionId);
        return getAgentInvocations(deps.repository, tenantId, decisionId);
      }

      case 'getComplianceChecks': {
        const decisionId = DecisionIdSchema.parse(args.decisionId);
        return getComplianceChecks(deps.repository, tenantId, decisionId);
      }

      // Mutations
      case 'confirmDecision': {
        const decisionId = DecisionIdSchema.parse(args.decisionId);
        return confirmDecision(deps.repository, tenantId, userId, decisionId);
      }

      case 'rejectDecision': {
        const { decisionId, reason } = RejectDecisionInputSchema.parse({
          decisionId: args.decisionId,
          reason: args.reason,
        });
        return rejectDecision(deps.repository, tenantId, userId, decisionId, reason);
      }

      case 'recordExplanationView': {
        const decisionId = DecisionIdSchema.parse(args.decisionId);
        return recordExplanationView(deps.repository, tenantId, userId, decisionId);
      }

      default:
        throw new Error(`Unknown field: ${fieldName}`);
      }
    } catch (error) {
      logger.error('GraphQL resolver error', { error, fieldName: event.info.fieldName });
      throw error;
    }
  };

// Production wiring
const TABLE_NAME = requireEnv('TABLE_NAME');
const bus = new EventBridgeBus(requireEnv('BUS_NAME'), 'advisory-bff');
const resolverDeps: ResolverDeps = {
  repository: new AdvisoryRepository(TABLE_NAME, new DynamoDBClient({})),
};

export const handler = applyMiddleware(
  createResolver(resolverDeps) as (event: unknown) => Promise<unknown>,
  withErrorPublishing(bus, 'ADVISORY_BFF_FAILED'),
  withLambdaContext(),
  withTiming('advisory-bff-graphql-resolver'),
);
