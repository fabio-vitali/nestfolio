import '../read-model-ownership';
import { createHash } from 'node:crypto';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { materializeToTable, record, skip, type WriteIntent, type EventPayload, type EventContext } from '@nestfolio/event-processor';
import { requireEnv, logger } from '@nestfolio/event-processor';
import { LedgerCtrlEventTypes } from '@nestfolio/ledger-ctrl/events';
import { ExecutionCrossDomainEventTypes } from '@nestfolio/execution-adpt/domain';
import { ReconciliationRepository, type CachedPositionSnapshot } from '../repositories/reconciliation.repository';
import { ReconciliationService } from '../services/reconciliation.service';
import type { ReconciliationResult, DriftRecord } from '../domain/contracts';

const DEFAULT_STALENESS_MS = 24 * 60 * 60 * 1000; // 24 hours

export interface EventListenerDeps {
  readonly reconciliationService: ReconciliationService;
  readonly repository: ReconciliationRepository;
  readonly stalenessWindowMs: number;
}

// ---------------------------------------------------------------------------
// Position normalization
// ---------------------------------------------------------------------------

type PositionEntry = { instrument: string; quantity: number };

/**
 * Normalizes positions from different event formats:
 * - PORTFOLIO_UPDATED CDC: Record<string, { symbol, quantity, ... }> (object keyed by symbol)
 * - ALPACA_ACCOUNT_SNAPSHOT: Array<{ symbol, qty, marketValue }> (array with qty field)
 * - Generic: Array<{ symbol, quantity }> (array with quantity field)
 */
function normalizePositions(
  raw: unknown,
  fieldMapping: { quantityField: 'quantity' | 'qty' },
): PositionEntry[] {
  if (!raw) return [];

  // Array format (ALPACA_ACCOUNT_SNAPSHOT or generic)
  if (Array.isArray(raw)) {
    return raw.map((p: Record<string, unknown>) => ({
      instrument: (p.symbol as string) ?? '',
      quantity: (p[fieldMapping.quantityField] as number) ?? 0,
    }));
  }

  // Object format (PORTFOLIO_UPDATED CDC — Record<string, PositionSnapshot>)
  if (typeof raw === 'object') {
    return Object.values(raw as Record<string, Record<string, unknown>>).map((p) => ({
      instrument: (p.symbol as string) ?? '',
      quantity: (p.quantity as number) ?? 0,
    }));
  }

  return [];
}

// ---------------------------------------------------------------------------
// Staleness check
// ---------------------------------------------------------------------------

function isFresh(snapshot: CachedPositionSnapshot, stalenessMs: number): boolean {
  const age = Date.now() - new Date(snapshot.capturedAt).getTime();
  return age < stalenessMs;
}

// ---------------------------------------------------------------------------
// Content-derived reconciliationId
// ---------------------------------------------------------------------------

// Reconciliation is a pure function of (intentPositions, settlementPositions).
// Deriving the id from those positions instead of from ctx.eventId makes the
// idempotency key stable across at-least-once redelivery of EITHER cache event
// (e.g. ALPACA_ACCOUNT_SNAPSHOT redelivered after PORTFOLIO_UPDATED has cached
// Intent). Same content → same id → CCFE on the second PutItem → dedup. Two
// distinct logical states (different positions) → distinct ids → distinct
// reconciliations, as intended.
//
// Canonicalization caveat: positions may arrive from two sources — freshly
// normalized in-handler, OR retrieved from the position-cache row in DDB. The
// DDB SDK reconstructs object attributes without a guaranteed key order, so
// JSON.stringify on raw entries can produce DIFFERENT strings for the SAME
// {instrument, quantity} pair depending on the source. Avoid this by
// formatting each entry as `${instrument}:${quantity}` (no JSON, no object
// key order) before joining.
function deriveReconciliationId(intent: PositionEntry[], settlement: PositionEntry[]): string {
  const canonical = (positions: PositionEntry[]): string =>
    [...positions]
      .sort((a, b) => a.instrument.localeCompare(b.instrument))
      .map((p) => `${p.instrument}:${p.quantity}`)
      .join(',');
  return createHash('sha256')
    .update(canonical(intent))
    .update('|')
    .update(canonical(settlement))
    .digest('hex')
    .slice(0, 32);
}

// ---------------------------------------------------------------------------
// Cache-and-compare reconciliation
// ---------------------------------------------------------------------------

async function cacheAndReconcile(
  deps: EventListenerDeps,
  mySide: 'Intent' | 'Settlement',
  myPositions: PositionEntry[],
  sourceEventType: string,
  ctx: EventContext,
): Promise<WriteIntent | WriteIntent[]> {
  const tenantId = ctx.tenantId;

  // 1. Cache our side
  await deps.repository.putPositionSnapshot(tenantId, mySide, myPositions, sourceEventType);

  // 2. Read the other side
  const otherSide = mySide === 'Intent' ? 'Settlement' : 'Intent';
  const otherSnapshot = await deps.repository.getPositionSnapshot(tenantId, otherSide);

  // 3. If other side doesn't exist or is stale, just cache and skip
  if (!otherSnapshot || !isFresh(otherSnapshot, deps.stalenessWindowMs)) {
    logger.info('Cached position snapshot, other side not available or stale', {
      tenantId, mySide, otherSideExists: !!otherSnapshot,
    });
    return skip();
  }

  // 4. Both sides available — reconcile
  const intentPositions = mySide === 'Intent' ? myPositions : otherSnapshot.positions;
  const settlementPositions = mySide === 'Settlement' ? myPositions : otherSnapshot.positions;
  const reconciliationId = deriveReconciliationId(intentPositions, settlementPositions);

  const portfolioId = tenantId;
  const result = await deps.reconciliationService.reconcile(reconciliationId, {
    tenantId,
    portfolioId,
    intentPositions,
    settlementPositions,
  });

  const pk = `Reconciliation#${tenantId}#${reconciliationId}`;

  const resultSubject: ReconciliationResult = {
    reconciliationId,
    status: result.status,
    driftCount: result.drifts.length,
  };
  return [
    record('ReconciliationResult', { tenantId, ...resultSubject }, { pk, sk: 'Reconciliation' }),
    ...result.drifts.map((d) => {
      const driftSubject: DriftRecord = {
        reconciliationId,
        instrument: d.instrument,
        intentQty: d.intentQty,
        settlementQty: d.settlementQty,
        drift: d.drift,
      };
      return record('DriftRecord', { tenantId, ...driftSubject }, { pk, sk: `DriftRecord#${d.instrument}` });
    }),
  ];
}

// ---------------------------------------------------------------------------
// Handler factory
// ---------------------------------------------------------------------------

const INTENT_EVENT_TYPES = [
  LedgerCtrlEventTypes.PORTFOLIO_UPDATED,
  ExecutionCrossDomainEventTypes.PORTFOLIO_SNAPSHOT_IMPORTED,
  ExecutionCrossDomainEventTypes.CORPORATE_ACTION_APPLIED,
] as const;

export const createHandlers = (deps: EventListenerDeps) => {
  const handlers: Record<string, (payload: EventPayload, ctx: EventContext) => Promise<WriteIntent | WriteIntent[]>> = {};

  // Intent-side events (positions from internal ledger)
  for (const type of INTENT_EVENT_TYPES) {
    handlers[type] = async (payload, ctx) => {
      const positions = normalizePositions(payload.subject?.positions, { quantityField: 'quantity' });
      return cacheAndReconcile(deps, 'Intent', positions, ctx.eventType, ctx);
    };
  }

  // Settlement-side event (positions from broker)
  handlers[ExecutionCrossDomainEventTypes.ALPACA_ACCOUNT_SNAPSHOT] = async (payload, ctx) => {
    const positions = normalizePositions(payload.subject?.positions, { quantityField: 'qty' });
    return cacheAndReconcile(deps, 'Settlement', positions, ctx.eventType, ctx);
  };

  return handlers;
};

// ---------------------------------------------------------------------------
// Production wiring
// ---------------------------------------------------------------------------

const TABLE_NAME = requireEnv('TABLE_NAME');
const dynamoClient = new DynamoDBClient({});
const repository = new ReconciliationRepository(TABLE_NAME, dynamoClient);
const reconciliationService = new ReconciliationService();
const stalenessWindowMs = parseInt(process.env['STALENESS_WINDOW_MS'] ?? `${DEFAULT_STALENESS_MS}`, 10);

const deps: EventListenerDeps = {
  reconciliationService,
  repository,
  stalenessWindowMs,
};

export const handler = materializeToTable({
  serviceName: 'reconciliation-ctrl',
  handlers: createHandlers(deps),
  errorEventType: 'RECONCILIATION_CTRL_FAILED',
});
