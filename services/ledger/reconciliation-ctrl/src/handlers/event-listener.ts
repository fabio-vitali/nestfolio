import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { createEventHandler, skip, type EventPayload, type EventContext } from '@nestfolio/event-processor';
import { requireEnv } from '@nestfolio/event-processor';
import { LedgerCtrlEventTypes } from '@nestfolio/ledger-ctrl/service';
import { ExecutionAdptEventTypes } from '@nestfolio/broker-adpt/service';
import { ReconciliationRepository } from '../repositories/reconciliation.repository';
import { ReconciliationService } from '../services/reconciliation.service';

export interface EventListenerDeps {
  readonly reconciliationService: ReconciliationService;
}

const reconcileHandler = (deps: EventListenerDeps) =>
  async (payload: EventPayload, ctx: EventContext) => {
    const subject = payload.subject;
    const portfolioId = (subject?.portfolioId as string) ?? ctx.tenantId;
    const positions = (subject?.positions as Array<{ symbol: string; quantity: number }>) ?? [];

    await deps.reconciliationService.reconcile(ctx.eventId, {
      tenantId: ctx.tenantId,
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

    return skip();
  };

const EVENT_TYPES = [
  LedgerCtrlEventTypes.PORTFOLIO_UPDATED,
  ExecutionAdptEventTypes.PORTFOLIO_SNAPSHOT_IMPORTED,
  'CORPORATE_ACTION_APPLIED',
] as const;

export const createHandlers = (deps: EventListenerDeps) =>
  Object.fromEntries(
    EVENT_TYPES.map((type) => [type, reconcileHandler(deps)]),
  );

// Production wiring
const TABLE_NAME = requireEnv('TABLE_NAME');
const dynamoClient = new DynamoDBClient({});
const repository = new ReconciliationRepository(TABLE_NAME, dynamoClient);
const reconciliationService = new ReconciliationService(repository);
const deps: EventListenerDeps = { reconciliationService };

export const handler = createEventHandler({
  serviceName: 'reconciliation-ctrl',
  handlers: createHandlers(deps),
  table: TABLE_NAME,
  bus: requireEnv('BUS_NAME'),
  errorEventType: 'RECONCILIATION_CTRL_FAILED',
});
