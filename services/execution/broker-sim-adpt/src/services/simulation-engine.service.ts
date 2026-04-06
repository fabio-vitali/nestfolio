import { logger, NotRetryableError, type RequestContext } from '@nestfolio/event-processor';
import { withMethodLogging } from '@nestfolio/event-processor';
import { VirtualLedgerRepository } from '../repositories/virtual-ledger.repository';
import { MarketDataService } from './market-data.service';

export interface FillResult {
  orderId: string;
  status: 'FILLED' | 'REJECTED';
  fillPrice?: number;
  fillQuantity?: number;
  totalValue?: number;
  rejectReason?: string;
}

export class SimulationEngineService {
  private readonly log = withMethodLogging('SimulationEngineService');

  constructor(
    private readonly repository: VirtualLedgerRepository,
    private readonly marketData: MarketDataService,
  ) {}

  readonly processOrderSubmitted = this.log('processOrderSubmitted',
    async (
      orderId: string,
      symbol: string,
      side: 'BUY' | 'SELL',
      quantity: number,
      ctx: RequestContext,
    ): Promise<FillResult> => {
      // 0. Validate quantity
      if (!quantity || quantity <= 0) {
        throw new NotRetryableError(`Invalid quantity: ${quantity}`);
      }

      // 1. Get fill price
      const fillPrice = await this.marketData.getPrice(symbol);
      if (!fillPrice) {
        logger.info('Order rejected: unknown symbol', { orderId, symbol });
        return { orderId, status: 'REJECTED', rejectReason: `Unknown symbol: ${symbol}` };
      }

      const totalValue = quantity * fillPrice;

      // 2. Load current state
      const cashBalance = await this.repository.getCashBalance(ctx.tenantId, ctx.userId, 'USD');
      const position = await this.repository.getPosition(ctx.tenantId, ctx.userId, symbol);

      // 3. Validate
      if (side === 'BUY') {
        const balance = (cashBalance?.balance as number) ?? 0;
        if (balance < totalValue) {
          logger.info('Order rejected: insufficient cash', { orderId, balance, totalValue });
          return {
            orderId,
            status: 'REJECTED',
            rejectReason: `Insufficient cash: have ${balance}, need ${totalValue}`,
          };
        }
      } else {
        const positionQty = (position?.quantity as number) ?? 0;
        if (positionQty < quantity) {
          logger.info('Order rejected: insufficient position', { orderId, positionQty, quantity });
          return {
            orderId,
            status: 'REJECTED',
            rejectReason: `Insufficient position: have ${positionQty}, need ${quantity}`,
          };
        }
      }

      // 4. Execute trade atomically
      const currentBalance = (cashBalance?.balance as number) ?? 0;
      await this.repository.executeTrade({
        tradeId: orderId,
        orderId,
        symbol,
        side,
        quantity,
        fillPrice,
        totalValue,
        cashBefore: currentBalance,
        cashAfter: side === 'BUY' ? currentBalance - totalValue : currentBalance + totalValue,
      }, ctx);

      logger.info('Order filled', { orderId, symbol, side, quantity, fillPrice, totalValue });

      return { orderId, status: 'FILLED', fillPrice, fillQuantity: quantity, totalValue };
    },
  );

  readonly processWithdrawal = this.log('processWithdrawal',
    async (
      withdrawalId: string,
      amount: number,
      ctx: RequestContext,
    ): Promise<{ status: 'COMPLETED' | 'REJECTED'; reason?: string }> => {
      const cashBalance = await this.repository.getCashBalance(ctx.tenantId, ctx.userId, 'USD');
      const balance = (cashBalance?.balance as number) ?? 0;
      const currentVersion = (cashBalance?.version as number) ?? 0;

      if (balance < amount) {
        logger.info('Withdrawal rejected: insufficient cash', { withdrawalId, balance, amount });
        return {
          status: 'REJECTED',
          reason: `Insufficient cash: have ${balance}, need ${amount}`,
        };
      }

      // Debit cash with optimistic locking
      await this.repository.updateCashBalanceConditional('USD', balance - amount, currentVersion, ctx);

      logger.info('Withdrawal completed', { withdrawalId, amount, newBalance: balance - amount });
      return { status: 'COMPLETED' };
    },
  );

  readonly initializeAccount = this.log('initializeAccount',
    async (
      ctx: RequestContext,
      initialBalance: number = 100_000,
    ): Promise<void> => {
      await this.repository.initializeCashBalance('USD', initialBalance, ctx);
      logger.info('Account initialized', { tenantId: ctx.tenantId, userId: ctx.userId, initialBalance });
    },
  );
}
