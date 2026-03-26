import { withMethodLogging, logger } from '@nestfolio/event-processor';
import { LedgerRepository } from '../repositories/ledger.repository';

export interface OpenLotParams {
  tenantId: string;
  orderId: string;
  symbol: string;
  quantity: number;
  costBasisPerShare: number;
  acquiredAt: string;
}

export interface CloseLotParams {
  tenantId: string;
  symbol: string;
  quantity: number;
  salePrice: number;
  soldAt: string;
  orderId: string;
}

export interface DispositionRecord {
  lotId: string;
  symbol: string;
  quantitySold: number;
  costBasisPerShare: number;
  salePrice: number;
  realizedGain: number;
  holdingPeriod: 'short-term' | 'long-term';
  acquiredAt: string;
  soldAt: string;
}

export interface TaxLot {
  pk: string;
  sk: string;
  __typename: 'TaxLot';
  tenantId: string;
  lotId: string;
  symbol: string;
  quantity: number;
  costBasisPerShare: number;
  acquiredAt: string;
  status: 'open' | 'closed';
}

export class TaxLotManager {
  private readonly log = withMethodLogging('TaxLotManager');

  constructor(private readonly repository: LedgerRepository) {}

  readonly openLot = this.log('openLot',
    async (params: OpenLotParams): Promise<void> => {
      const lotId = `${params.orderId}-${params.symbol}`;
      const lot: TaxLot = {
        pk: `TaxLot#${params.tenantId}#${params.symbol}`,
        sk: `Lot#${params.acquiredAt}#${lotId}`,
        __typename: 'TaxLot',
        tenantId: params.tenantId,
        lotId,
        symbol: params.symbol,
        quantity: params.quantity,
        costBasisPerShare: params.costBasisPerShare,
        acquiredAt: params.acquiredAt,
        status: 'open',
      };
      await this.repository.putTaxLot(lot);
      logger.info('Tax lot opened', { lotId, symbol: params.symbol, quantity: params.quantity });
    },
  );

  readonly closeLots = this.log('closeLots',
    async (params: CloseLotParams): Promise<DispositionRecord[]> => {
      const lots = await this.repository.getOpenLotsBySymbol(params.tenantId, params.symbol);
      // FIFO: sorted by acquiredAt ascending (sk sort ensures this)

      const dispositions: DispositionRecord[] = [];
      let remainingToSell = params.quantity;

      for (const lot of lots) {
        if (remainingToSell <= 0) break;

        const lotQty = lot.quantity as number;
        const qtyFromThisLot = Math.min(lotQty, remainingToSell);
        const costBasis = lot.costBasisPerShare as number;
        const realizedGain = (params.salePrice - costBasis) * qtyFromThisLot;

        // Determine holding period
        const acquiredAt = new Date(lot.acquiredAt as string);
        const soldAt = new Date(params.soldAt);
        const holdingMs = soldAt.getTime() - acquiredAt.getTime();
        const oneYearMs = 365 * 24 * 60 * 60 * 1000;
        const holdingPeriod: 'short-term' | 'long-term' = holdingMs >= oneYearMs ? 'long-term' : 'short-term';

        dispositions.push({
          lotId: lot.lotId as string,
          symbol: params.symbol,
          quantitySold: qtyFromThisLot,
          costBasisPerShare: costBasis,
          salePrice: params.salePrice,
          realizedGain,
          holdingPeriod,
          acquiredAt: lot.acquiredAt as string,
          soldAt: params.soldAt,
        });

        // Update or close the lot
        const newQty = lotQty - qtyFromThisLot;
        if (newQty === 0) {
          await this.repository.closeTaxLot(lot.pk as string, lot.sk as string);
        } else {
          await this.repository.updateTaxLotQuantity(lot.pk as string, lot.sk as string, newQty);
        }

        remainingToSell -= qtyFromThisLot;
      }

      // Write disposition records
      for (const disp of dispositions) {
        await this.repository.putDisposition(params.tenantId, disp);
      }

      logger.info('Tax lots closed', {
        symbol: params.symbol,
        totalSold: params.quantity - remainingToSell,
        dispositions: dispositions.length,
      });

      return dispositions;
    },
  );

  readonly getUnrealizedGains = this.log('getUnrealizedGains',
    async (tenantId: string, symbol: string, currentPrice: number): Promise<number> => {
      const lots = await this.repository.getOpenLotsBySymbol(tenantId, symbol);
      let totalUnrealized = 0;
      for (const lot of lots) {
        const qty = lot.quantity as number;
        const costBasis = lot.costBasisPerShare as number;
        totalUnrealized += (currentPrice - costBasis) * qty;
      }
      return totalUnrealized;
    },
  );
}
