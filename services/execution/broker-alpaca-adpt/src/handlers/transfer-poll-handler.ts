import { logger, requireEnv, getTime } from '@nestfolio/event-processor';
import { AlpacaClient } from '../clients/alpaca.client';
import { TransferMappingRepository } from '../repositories/transfer-mapping.repository';

const TABLE_NAME = requireEnv('TABLE_NAME');
const transferRepo = new TransferMappingRepository(TABLE_NAME);
const client = new AlpacaClient();

interface PollInput {
  action: 'poll' | 'write' | 'timeout';
  tenantId: string;
  nestfolioTransferId: string;
  alpacaTransferId: string;
  backoffSeconds: number;
  // Present when action = 'write'
  status?: string;
  failureReason?: string;
}

const TERMINAL_STATUS_MAP: Record<string, string> = {
  COMPLETE: 'COMPLETED',
  REJECTED: 'FAILED',
  RETURNED: 'FAILED',
};

export async function handler(event: PollInput) {
  const { action, tenantId, nestfolioTransferId, alpacaTransferId, backoffSeconds } = event;

  if (action === 'poll') {
    return pollTransfer(tenantId, nestfolioTransferId, alpacaTransferId, backoffSeconds);
  }
  if (action === 'write') {
    return writeResult(event);
  }
  if (action === 'timeout') {
    return handleTimeout(tenantId, nestfolioTransferId);
  }
  throw new Error(`Unknown action: ${action}`);
}

async function pollTransfer(tenantId: string, nestfolioTransferId: string, alpacaTransferId: string, backoffSeconds: number) {
  const result = await client.getTransfer(alpacaTransferId);

  if (result.status === 404) {
    logger.info('Transfer not found at Alpaca, marking FAILED', { alpacaTransferId });
    return { status: 'FAILED', tenantId, nestfolioTransferId, alpacaTransferId, failureReason: 'Transfer not found at Alpaca', backoffSeconds };
  }
  if (result.status === 429 || result.status >= 500) {
    throw new Error(`Alpaca API error: ${result.status}`);
  }

  const alpacaStatus = result.data.status;
  const mappedStatus = TERMINAL_STATUS_MAP[alpacaStatus] ?? 'PENDING';
  const failureReason = mappedStatus === 'FAILED' ? `Alpaca status: ${alpacaStatus}` : undefined;

  logger.info('Polled transfer status', { alpacaTransferId, alpacaStatus, mappedStatus });

  return { status: mappedStatus, tenantId, nestfolioTransferId, alpacaTransferId, failureReason, backoffSeconds };
}

async function writeResult(event: PollInput) {
  const { tenantId, nestfolioTransferId, status, failureReason } = event;
  const updates: Record<string, unknown> = {};
  if (status === 'COMPLETED') updates.completedAt = getTime();
  if (failureReason) updates.failureReason = failureReason;

  await transferRepo.updateStatus(tenantId, nestfolioTransferId, status!, updates);
  logger.info('Wrote transfer result', { tenantId, nestfolioTransferId, status });
}

async function handleTimeout(tenantId: string, nestfolioTransferId: string) {
  logger.info('Transfer polling timeout', { tenantId, nestfolioTransferId });
  await transferRepo.updateStatus(tenantId, nestfolioTransferId, 'FAILED', {
    failureReason: 'Polling timeout — transfer unresolved',
  });
}
