import { AppSyncResolverEvent } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { logger } from '@nestfolio/platform-core';
import { requireEnv, authorizeTenant } from '@nestfolio/lambda-utils';
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

const TABLE_NAME = requireEnv('TABLE_NAME');
const repository = new AdvisoryRepository(TABLE_NAME, new DynamoDBClient({}));

export const handler = async (
  event: AppSyncResolverEvent<Record<string, unknown>>,
): Promise<unknown> => {
  try {
    const tenantId = authorizeTenant(event);
    const fieldName = event.info.fieldName;
    const claims = event.identity as Record<string, unknown> | undefined;
    const userId = (claims?.['claims'] as Record<string, string>)?.['sub'] ?? '';
    const args = event.arguments ?? {};

    logger.info('Resolving field', { fieldName, tenantId, userId });

    switch (fieldName) {
    // Queries
    case 'getDecision':
      return getDecision(repository, tenantId, args.decisionId as string);

    case 'getPendingDecisions': {
      const limit = (args.limit as number) ?? 20;
      const cursor = args.cursor as string | undefined;
      return getPendingDecisions(repository, tenantId, limit, cursor);
    }

    case 'getDecisionHistory': {
      const limit = (args.limit as number) ?? 20;
      const cursor = args.cursor as string | undefined;
      return getDecisionHistory(repository, tenantId, limit, cursor);
    }

    case 'getAgentInvocations':
      return getAgentInvocations(repository, tenantId, args.decisionId as string);

    case 'getComplianceChecks':
      return getComplianceChecks(repository, tenantId, args.decisionId as string);

    // Mutations
    case 'confirmDecision':
      return confirmDecision(repository, tenantId, userId, args.decisionId as string);

    case 'rejectDecision':
      return rejectDecision(
        repository,
        tenantId,
        userId,
        args.decisionId as string,
        args.reason as string,
      );

    case 'recordExplanationView':
      return recordExplanationView(repository, tenantId, userId, args.decisionId as string);

    default:
      throw new Error(`Unknown field: ${fieldName}`);
    }
  } catch (error) {
    logger.error('GraphQL resolver error', { error, fieldName: event.info.fieldName });
    throw error;
  }
};
