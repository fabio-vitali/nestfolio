import { AppSyncResolverEvent } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { logger } from '@nestfolio/platform-core';
import { requireEnv, authorizeTenant } from '@nestfolio/lambda-utils';
import { DashboardRepository } from '../repositories/dashboard.repository';

const TABLE_NAME = requireEnv('TABLE_NAME');
const repository = new DashboardRepository(TABLE_NAME, new DynamoDBClient({}));

export const handler = async (
  event: AppSyncResolverEvent<Record<string, unknown>>,
): Promise<unknown> => {
  try {
    const tenantId = authorizeTenant(event);
    const fieldName = event.info.fieldName;
    const args = event.arguments ?? {};

    logger.info('Resolving field', { fieldName, tenantId });

    switch (fieldName) {
      case 'getDashboard':
        return repository.getDashboard(tenantId);

      case 'getPositionSnapshots':
        return repository.getPositionSnapshots(tenantId);

      case 'getRecentActivity': {
        const limit = (args.limit as number) ?? 20;
        return repository.getRecentActivity(tenantId, limit);
      }

      default:
        throw new Error(`Unknown field: ${fieldName}`);
    }
  } catch (error) {
    logger.error('GraphQL resolver error', { error, fieldName: event.info.fieldName });
    throw error;
  }
};
