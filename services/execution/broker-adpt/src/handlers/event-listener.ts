import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { logger, NotRetryableError } from '@nestfolio/event-processor';
import { requireEnv } from '@nestfolio/event-processor';
import { createEventHandler, skip, type EventPayload, type EventContext } from '@nestfolio/event-processor';
import { ExecutionCtrlEventTypes } from '@nestfolio/execution-ctrl/domain';
import { InvestorBffEventTypes } from '@nestfolio/investor-bff/domain';
import { VirtualLedgerRepository } from '../repositories/virtual-ledger.repository';
import { MarketDataService } from '../services/market-data.service';
import { SimulationEngineService } from '../services/simulation-engine.service';

export interface EventListenerDeps {
  readonly repository: VirtualLedgerRepository;
  readonly simulationEngine: SimulationEngineService;
}

export function createHandlers(deps: EventListenerDeps) {
  return {
    [ExecutionCtrlEventTypes.ORDER_SUBMITTED]: async (payload: EventPayload, ctx: EventContext) => {
      const subject = payload.subject;
      if (!subject) {
        throw new NotRetryableError(`Missing subject in ORDER_SUBMITTED event ${ctx.eventId}`);
      }
      const tenantId = ctx.tenantId;
      const userId = (subject.userId as string) ?? tenantId;
      const orderId = subject.orderId as string;
      const symbol = subject.symbol as string;
      const side = subject.side as 'BUY' | 'SELL';
      const quantity = subject.quantity as number;

      if (!orderId || !symbol || !side || quantity === undefined) {
        throw new NotRetryableError(
          `Missing required ORDER_SUBMITTED fields: orderId=${orderId}, symbol=${symbol}, side=${side}, quantity=${quantity}`,
        );
      }

      // Ensure simulation account exists (lazy initialization)
      const cashBalance = await deps.repository.getCashBalance(tenantId, userId, 'USD');
      if (!cashBalance) {
        await deps.simulationEngine.initializeAccount(tenantId, userId);
      }

      try {
        const result = await deps.simulationEngine.processOrderSubmitted(
          tenantId,
          userId,
          orderId,
          symbol,
          side,
          quantity,
        );

        logger.info('Order simulation complete', {
          orderId,
          status: result.status,
          fillPrice: result.fillPrice,
          rejectReason: result.rejectReason,
        });
      } catch (error) {
        if ((error as Error).name === 'TransactionCanceledException') {
          logger.info('Order already processed, skipping', { orderId, eventId: ctx.eventId });
          return skip();
        }
        throw error;
      }

      return skip();
    },

    [InvestorBffEventTypes.WITHDRAWAL_REQUESTED]: async (payload: EventPayload, ctx: EventContext) => {
      const subject = payload.subject;
      if (!subject) {
        throw new NotRetryableError(`Missing subject in WITHDRAWAL_REQUESTED event ${ctx.eventId}`);
      }
      const tenantId = ctx.tenantId;
      const userId = (subject.userId as string) ?? tenantId;
      const withdrawalId = subject.withdrawalId as string;
      const amount = subject.amount as number;

      if (!withdrawalId || amount === undefined) {
        throw new NotRetryableError(
          `Missing required WITHDRAWAL_REQUESTED fields: withdrawalId=${withdrawalId}, amount=${amount}`,
        );
      }

      // Check sufficient balance before guarded write
      const cashBalance = await deps.repository.getCashBalance(tenantId, userId, 'USD');
      const balance = (cashBalance?.balance as number) ?? 0;

      if (balance < amount) {
        logger.info('Withdrawal rejected: insufficient cash', { withdrawalId, balance, amount });
        return skip();
      }

      // Guarded atomic debit — idempotent via event-keyed guard marker
      const processed = await deps.repository.guardedAddToCashBalance(
        tenantId, userId, 'USD', -amount, ctx.eventId,
      );
      if (!processed) {
        logger.info('Withdrawal already processed, skipping', { eventId: ctx.eventId });
        return skip();
      }

      logger.info('Withdrawal completed', { withdrawalId, amount, newBalance: balance - amount });
      return skip();
    },

    [InvestorBffEventTypes.DEPOSIT_INITIATED]: async (payload: EventPayload, ctx: EventContext) => {
      const subject = payload.subject;
      if (!subject) {
        throw new NotRetryableError(`Missing subject in DEPOSIT_INITIATED event ${ctx.eventId}`);
      }
      const tenantId = ctx.tenantId;
      const userId = (subject.userId as string) ?? tenantId;
      const depositId = subject.depositId as string;
      const amountCents = subject.amountCents as number;
      const currency = (subject.currency as string) ?? 'USD';

      if (!depositId || amountCents === undefined) {
        throw new NotRetryableError(
          `Missing required DEPOSIT_INITIATED fields: depositId=${depositId}, amountCents=${amountCents}`,
        );
      }

      // Convert cents to dollars for virtual ledger
      const amount = amountCents / 100;

      // Ensure simulation account exists (lazy initialization)
      const cashBalance = await deps.repository.getCashBalance(tenantId, userId, currency);
      if (!cashBalance) {
        await deps.simulationEngine.initializeAccount(tenantId, userId);
      }

      // Guarded atomic credit — idempotent via event-keyed guard marker
      const processed = await deps.repository.guardedAddToCashBalance(
        tenantId, userId, currency, amount, ctx.eventId,
      );
      if (!processed) {
        logger.info('Deposit already processed, skipping', { eventId: ctx.eventId });
        return skip();
      }

      logger.info('Deposit processed', { depositId, amount, tenantId });
      return skip();
    },
  };
}

// Production wiring
const TABLE_NAME = requireEnv('TABLE_NAME');
const dynamoClient = new DynamoDBClient({});
const repository = new VirtualLedgerRepository(TABLE_NAME, dynamoClient);
const marketData = new MarketDataService();
const simulationEngine = new SimulationEngineService(repository, marketData);

export const handler = createEventHandler({
  serviceName: 'broker-adpt',
  handlers: createHandlers({ repository, simulationEngine }),
  table: TABLE_NAME,
  bus: requireEnv('BUS_NAME'),
  errorEventType: 'EXECUTION_ADPT_FAILED',
});
