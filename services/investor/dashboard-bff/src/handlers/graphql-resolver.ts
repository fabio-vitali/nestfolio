import { AppSyncResolverEvent } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { logger } from '@nestfolio/platform-core';
import { requireEnv, authorizeUser, validateQueryDepth, applyMiddleware, withLambdaContext, withTiming } from '@nestfolio/lambda-utils';
import { DashboardRepository } from '../repositories/dashboard.repository';

export interface ResolverDeps {
  readonly repository: DashboardRepository;
}

export const createResolver = (deps: ResolverDeps) =>
  async (
    event: AppSyncResolverEvent<Record<string, unknown>>,
  ): Promise<unknown> => {
    try {
      validateQueryDepth(event.info.selectionSetGraphQL);
      const { tenantId, userId } = authorizeUser(event);
      const fieldName = event.info.fieldName;
      const args = event.arguments ?? {};

      logger.info('Resolving field', { fieldName, tenantId, userId });

      switch (fieldName) {
        case 'getDashboard':
          return deps.repository.getDashboard(tenantId);

        case 'getPositionSnapshots':
          return deps.repository.getPositionSnapshots(tenantId);

        case 'getRecentActivity': {
          const limit = (args.limit as number) ?? 20;
          return deps.repository.getRecentActivity(tenantId, limit);
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
const resolverDeps: ResolverDeps = {
  repository: new DashboardRepository(TABLE_NAME, new DynamoDBClient({})),
};

export const handler = applyMiddleware(
  createResolver(resolverDeps) as (event: unknown) => Promise<unknown>,
  withLambdaContext(),
  withTiming('dashboard-bff-graphql-resolver'),
);
