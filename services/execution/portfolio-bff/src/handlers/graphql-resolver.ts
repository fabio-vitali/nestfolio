import { AppSyncResolverEvent } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { logger } from '@nestfolio/platform-core';
import { requireEnv } from '@nestfolio/lambda-utils';
import { PortfolioRepository } from '../repositories/portfolio.repository';

const TABLE_NAME = requireEnv('TABLE_NAME');
const repository = new PortfolioRepository(TABLE_NAME, new DynamoDBClient({}));

export const handler = async (
  event: AppSyncResolverEvent<Record<string, unknown>>,
): Promise<unknown> => {
  const fieldName = event.info.fieldName;
  const claims = event.identity as Record<string, unknown> | undefined;
  const tenantId = (claims?.['claims'] as Record<string, string>)?.['custom:tenant_id'] ?? '';
  const portfolioId = tenantId; // default portfolio = tenant
  const args = event.arguments ?? {};

  logger.info('Resolving field', { fieldName, tenantId });

  switch (fieldName) {
    case 'getPortfolio':
      return repository.getOrCreatePortfolio(tenantId, portfolioId);

    case 'getPositions':
      return repository.getAllPositions(tenantId, portfolioId);

    case 'getCashBalance': {
      const currency = (args.currency as string) ?? 'USD';
      const balance = await repository.getCashBalance(tenantId, portfolioId, currency);
      return balance ?? { currency, amount: 0, updatedAt: new Date().toISOString() };
    }

    case 'getPerformance': {
      const period = args.period as string;
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
};
