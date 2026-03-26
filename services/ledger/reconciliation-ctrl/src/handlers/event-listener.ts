import { materializeToTable, record, type WriteIntent, type EventPayload, type EventContext } from '@nestfolio/event-processor';
import { requireEnv } from '@nestfolio/event-processor';
import { LedgerCtrlEventTypes } from '@nestfolio/ledger-ctrl/events';
import { ExecutionCrossDomainEventTypes } from '@nestfolio/execution-adpt/domain';
import { ReconciliationService } from '../services/reconciliation.service';

export interface EventListenerDeps {
  readonly reconciliationService: ReconciliationService;
}

const reconcileHandler = (deps: EventListenerDeps) =>
  (payload: EventPayload, ctx: EventContext): WriteIntent[] => {
    const subject = payload.subject;
    const tenantId = ctx.tenantId;
    const reconciliationId = ctx.eventId;
    const portfolioId = (subject?.portfolioId as string) ?? tenantId;
    const positions = (subject?.positions as Array<{ symbol: string; quantity: number }>) ?? [];

    const result = deps.reconciliationService.reconcile(reconciliationId, {
      tenantId,
      portfolioId,
      intentPositions: positions.map((p) => ({
        instrument: p.symbol,
        quantity: p.quantity,
      })),
      settlementPositions: positions.map((p) => ({
        instrument: p.symbol,
        quantity: p.quantity,
      })),
    });

    const pk = `Reconciliation#${tenantId}#${reconciliationId}`;

    return [
      record('ReconciliationResult', {
        tenantId,
        reconciliationId,
        status: result.status,
        driftCount: result.drifts.length,
      }, { pk, sk: 'Reconciliation' }),
      ...result.drifts.map((d) =>
        record('DriftRecord', {
          tenantId,
          reconciliationId,
          instrument: d.instrument,
          intentQty: d.intentQty,
          settlementQty: d.settlementQty,
          drift: d.drift,
        }, { pk, sk: `DriftRecord#${d.instrument}` }),
      ),
    ];
  };

const alpacaSnapshotHandler = (deps: EventListenerDeps) =>
  (payload: EventPayload, ctx: EventContext): WriteIntent[] => {
    const subject = payload.subject;
    const tenantId = ctx.tenantId;
    const reconciliationId = ctx.eventId;
    const portfolioId = (subject?.portfolioId as string) ?? tenantId;
    const rawPositions = (subject?.positions as Array<{ symbol: string; qty: number }>) ?? [];

    const result = deps.reconciliationService.reconcile(reconciliationId, {
      tenantId,
      portfolioId,
      intentPositions: rawPositions.map((p) => ({
        instrument: p.symbol,
        quantity: p.qty,
      })),
      settlementPositions: rawPositions.map((p) => ({
        instrument: p.symbol,
        quantity: p.qty,
      })),
    });

    const pk = `Reconciliation#${tenantId}#${reconciliationId}`;

    return [
      record('ReconciliationResult', {
        tenantId,
        reconciliationId,
        status: result.status,
        driftCount: result.drifts.length,
      }, { pk, sk: 'Reconciliation' }),
      ...result.drifts.map((d) =>
        record('DriftRecord', {
          tenantId,
          reconciliationId,
          instrument: d.instrument,
          intentQty: d.intentQty,
          settlementQty: d.settlementQty,
          drift: d.drift,
        }, { pk, sk: `DriftRecord#${d.instrument}` }),
      ),
    ];
  };

const RECONCILE_EVENT_TYPES = [
  LedgerCtrlEventTypes.PORTFOLIO_UPDATED,
  ExecutionCrossDomainEventTypes.PORTFOLIO_SNAPSHOT_IMPORTED,
  'CORPORATE_ACTION_APPLIED',
] as const;

export const createHandlers = (deps: EventListenerDeps) => ({
  ...Object.fromEntries(
    RECONCILE_EVENT_TYPES.map((type) => [type, reconcileHandler(deps)]),
  ),
  [ExecutionCrossDomainEventTypes.ALPACA_ACCOUNT_SNAPSHOT]: alpacaSnapshotHandler(deps),
});

// Production wiring
requireEnv('TABLE_NAME'); // kept for environment validation
const reconciliationService = new ReconciliationService();
const deps: EventListenerDeps = { reconciliationService };

export const handler = materializeToTable({
  serviceName: 'reconciliation-ctrl',
  handlers: createHandlers(deps),
  errorEventType: 'RECONCILIATION_CTRL_FAILED',
});
