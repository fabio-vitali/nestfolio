import { logger } from '@nestfolio/event-processor';
import { withMethodLogging } from '@nestfolio/lambda-utils';
import { ReconciliationRepository } from '../repositories/reconciliation.repository';

export interface ReconciliationInput {
  tenantId: string;
  portfolioId: string;
  intentPositions: Array<{ instrument: string; quantity: number }>;
  settlementPositions: Array<{ instrument: string; quantity: number }>;
}

export interface ReconciliationResult {
  reconciliationId: string;
  status: 'COMPLETED' | 'DRIFT_DETECTED' | 'FAILED';
  driftRecords: Array<{
    instrument: string;
    intentQty: number;
    settlementQty: number;
    drift: number;
  }>;
}

export class ReconciliationService {
  private readonly log = withMethodLogging('ReconciliationService');

  constructor(private readonly repository: ReconciliationRepository) {}

  readonly reconcile = this.log('reconcile',
    async (reconciliationId: string, input: ReconciliationInput): Promise<ReconciliationResult> => {
      const created = await this.repository.createReconciliation(
        input.tenantId,
        reconciliationId,
        'MANUAL',
      );

      if (!created) {
        logger.info('Reconciliation already exists, skipping', { reconciliationId });
        return { reconciliationId, status: 'COMPLETED', driftRecords: [] };
      }

      const driftRecords: Array<{
        instrument: string;
        intentQty: number;
        settlementQty: number;
        drift: number;
      }> = [];

      // Compare intent vs settlement positions
      const intentMap = new Map(
        input.intentPositions.map((p) => [p.instrument, p.quantity]),
      );
      const settlementMap = new Map(
        input.settlementPositions.map((p) => [p.instrument, p.quantity]),
      );

      const allInstruments = new Set([
        ...intentMap.keys(),
        ...settlementMap.keys(),
      ]);

      for (const instrument of allInstruments) {
        const intentQty = intentMap.get(instrument) ?? 0;
        const settlementQty = settlementMap.get(instrument) ?? 0;
        const drift = intentQty - settlementQty;
        if (Math.abs(drift) > 0.001) {
          driftRecords.push({ instrument, intentQty, settlementQty, drift });
          await this.repository.createDriftRecord(
            input.tenantId,
            reconciliationId,
            instrument,
            intentQty,
            settlementQty,
            drift,
          );
        }
      }

      const status = driftRecords.length > 0 ? 'DRIFT_DETECTED' : 'COMPLETED';
      await this.repository.updateReconciliationStatus(
        input.tenantId,
        reconciliationId,
        status,
      );

      logger.info('Reconciliation completed', {
        reconciliationId,
        status,
        driftCount: driftRecords.length,
      });

      return { reconciliationId, status, driftRecords };
    },
  );
}
