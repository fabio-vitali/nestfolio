import { logger, requireEnv } from '@nestfolio/event-processor';
import { AlpacaClient } from '../clients/alpaca.client';
import { TransferMappingRepository } from '../repositories/transfer-mapping.repository';

const TABLE_NAME = requireEnv('TABLE_NAME');
const transferRepo = new TransferMappingRepository(TABLE_NAME);
const client = new AlpacaClient();

export async function processTransfersForTenant(tenantId: string) {
  const pendingTransfers = await transferRepo.getPendingTransfers(tenantId);
  if (pendingTransfers.length === 0) return;

  for (const transfer of pendingTransfers) {
    const alpacaTransferId = transfer.alpacaTransferId as string;
    const nestfolioTransferId = transfer.nestfolioTransferId as string;

    const result = await client.getTransfer(alpacaTransferId);
    const alpacaStatus = (result.data as any).status;

    if (alpacaStatus === 'COMPLETE') {
      await transferRepo.updateStatus(tenantId, nestfolioTransferId, 'COMPLETED', {
        completedAt: new Date().toISOString(),
      });
      logger.info('Transfer completed', { tenantId, nestfolioTransferId });
    } else if (alpacaStatus === 'REJECTED' || alpacaStatus === 'RETURNED') {
      await transferRepo.updateStatus(tenantId, nestfolioTransferId, 'FAILED', {
        failureReason: `Alpaca status: ${alpacaStatus}`,
      });
      logger.info('Transfer failed', { tenantId, nestfolioTransferId, alpacaStatus });
    }
    // else still PENDING — do nothing, next poll will check again
  }
}

export async function handler() {
  logger.info('Transfer status poller invoked');
  // Similar to trade-event-poller — would iterate tenants in production
}
