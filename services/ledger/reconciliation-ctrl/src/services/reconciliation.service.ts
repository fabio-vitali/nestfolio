import { logger } from '@nestfolio/event-processor';
import { withMethodLogging } from '@nestfolio/event-processor';

export interface ReconciliationInput {
  tenantId: string;
  portfolioId: string;
  intentPositions: Array<{ instrument: string; quantity: number }>;
  settlementPositions: Array<{ instrument: string; quantity: number }>;
}

export interface DriftEntry {
  instrument: string;
  intentQty: number;
  settlementQty: number;
  drift: number;
}

export interface ReconciliationComputeResult {
  status: 'COMPLETED' | 'DRIFT_DETECTED';
  drifts: DriftEntry[];
}

export class ReconciliationService {
  private readonly log = withMethodLogging('ReconciliationService');

  readonly reconcile = this.log('reconcile',
    (reconciliationId: string, input: ReconciliationInput): ReconciliationComputeResult => {
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

      const drifts: DriftEntry[] = [];

      for (const instrument of allInstruments) {
        const intentQty = intentMap.get(instrument) ?? 0;
        const settlementQty = settlementMap.get(instrument) ?? 0;
        const drift = intentQty - settlementQty;
        if (Math.abs(drift) > 0.001) {
          drifts.push({ instrument, intentQty, settlementQty, drift });
        }
      }

      const status = drifts.length > 0 ? 'DRIFT_DETECTED' : 'COMPLETED';

      logger.info('Reconciliation computed', {
        reconciliationId,
        status,
        driftCount: drifts.length,
      });

      return { status, drifts };
    },
  );
}
