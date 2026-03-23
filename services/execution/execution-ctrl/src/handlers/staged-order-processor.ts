import { logger, requireEnv } from '@nestfolio/event-processor';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import type { ProposedTrade } from '@nestfolio/advisory-adpt/domain';
import { OrderRepository } from '../repositories/order.repository';
import { SafetyChecksService } from '../services/safety-checks.service';

export interface StagedOrderProcessorDeps {
  readonly repository: OrderRepository;
  readonly safetyChecks: SafetyChecksService;
}

export interface ProcessingResult {
  submitted: number;
  rejected: number;
  errors: number;
}

export function createStagedOrderProcessor(deps: StagedOrderProcessorDeps): () => Promise<ProcessingResult> {
  return async (): Promise<ProcessingResult> => {
    const result: ProcessingResult = { submitted: 0, rejected: 0, errors: 0 };

    const stagedOrders = await deps.repository.getAllStagedOrders();
    logger.info('Staged order processor started', { stagedOrderCount: stagedOrders.length });

    if (stagedOrders.length === 0) {
      logger.info('No staged orders to process');
      return result;
    }

    for (const staged of stagedOrders) {
      const tenantId = staged['tenantId'] as string;
      const orderId = staged['orderId'] as string;
      const proposedTrades = (staged['proposedTrades'] ?? []) as ProposedTrade[];

      try {
        const safetyResult = await deps.safetyChecks.runAllChecks(tenantId, proposedTrades);

        if (safetyResult.passed) {
          await deps.repository.updateOrderStatus(tenantId, orderId, 'SUBMITTED');
          result.submitted++;
          logger.info('Staged order submitted', { tenantId, orderId });
        } else {
          await deps.repository.updateOrderStatus(tenantId, orderId, 'REJECTED', {
            reason: safetyResult.reason,
          });
          result.rejected++;
          logger.info('Staged order rejected', { tenantId, orderId, reason: safetyResult.reason });
        }

        await deps.repository.deleteStagedOrder(tenantId, orderId);
      } catch (error) {
        result.errors++;
        logger.error('Failed to process staged order', { tenantId, orderId, error });
      }
    }

    logger.info('Staged order processor complete', result);
    return result;
  };
}

// Production wiring
const TABLE_NAME = requireEnv('TABLE_NAME');
const dynamoClient = new DynamoDBClient({});
const repository = new OrderRepository(TABLE_NAME, dynamoClient);
const safetyChecks = new SafetyChecksService(repository);

const processStagedOrders = createStagedOrderProcessor({ repository, safetyChecks });

export const handler = async (): Promise<ProcessingResult> => {
  return processStagedOrders();
};
