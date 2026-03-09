import { AppSyncResolverEvent } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { logger } from '@nestfolio/platform-core';
import { requireEnv, authorizeTenant, validateQueryDepth } from '@nestfolio/lambda-utils';
import { PortfolioRepository } from '../repositories/portfolio.repository';
import { CurrencySchema, PerformancePeriodSchema } from '../validation/schemas';

const TABLE_NAME = requireEnv('TABLE_NAME');
const repository = new PortfolioRepository(TABLE_NAME, new DynamoDBClient({}));

export const handler = async (
  event: AppSyncResolverEvent<Record<string, unknown>>,
): Promise<unknown> => {
  try {
    validateQueryDepth(event.info.selectionSetGraphQL);
    const tenantId = authorizeTenant(event);
    const fieldName = event.info.fieldName;
    const portfolioId = tenantId; // default portfolio = tenant
    const args = event.arguments ?? {};

    logger.info('Resolving field', { fieldName, tenantId });

    switch (fieldName) {
      case 'getPortfolio':
        return repository.getOrCreatePortfolio(tenantId, portfolioId);

      case 'getPositions':
        return repository.getAllPositions(tenantId, portfolioId);

      case 'getCashBalance': {
        const currency = CurrencySchema.parse(args.currency);
        const balance = await repository.getCashBalance(tenantId, portfolioId, currency);
        return balance ?? { currency, amount: 0, updatedAt: new Date().toISOString() };
      }

      case 'getPerformance': {
        const period = PerformancePeriodSchema.parse(args.period);
        return {
          period,
          returnPercent: 0,
          returnAbsolute: 0,
          sharpeRatio: null,
          maxDrawdown: null,
        };
      }

      default:
        throw new Error(`Unknown field: ${fieldName}`);
    }
  } catch (error) {
    logger.error('GraphQL resolver error', { error, fieldName: event.info.fieldName });
    throw error;
  }
};
