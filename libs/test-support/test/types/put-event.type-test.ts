/**
 * Type-level tests for the typed putEvent overload. Validated by
 * `pnpm nx run test-support:typecheck` (tsc --noEmit). No runtime assertions: a
 * `@ts-expect-error` that does NOT error is itself a compile failure — that is the
 * test failing. `use(...)` keeps noUnusedLocals/no-unused-expressions satisfied.
 */
import { EventBridgeClient } from '../../src/fixtures/event-bridge-client';

declare function use(...xs: unknown[]): void;
declare const eb: EventBridgeClient;

// --- happy path: a complete, correct mandate subject typechecks ---
use(eb.putEvent({
  bus: 'advisory',
  targetService: 'compliance-ctrl',
  detailType: 'MANDATE_ISSUED',
  subject: { mandateId: 'm', level: 'DISCRETIONARY', status: 'ACTIVE', operatingMode: 'BALANCED', effectiveDate: '2026-01-15T00:00:00.000Z', __version: 1 },
  context: { userId: 'u' },
}));

// --- Bug B class: missing required subject fields is a compile error ---
use(eb.putEvent({
  bus: 'advisory',
  targetService: 'compliance-ctrl',
  detailType: 'RECOMMENDATION_PROPOSED',
  // @ts-expect-error — missing isInitialBuild + riskCategory (required by RecommendationProposedSchema)
  subject: { decisionId: 'd', taskToken: 't', awaitingCompliance: true as const, proposedTrades: [], portfolioValueCents: 1, currentPositions: [] },
}));

// --- Bug A class: an identity field in the subject is an excess-property error ---
// @ts-expect-error — userId is identity; it belongs in `context`, not the DRY subject
use(eb.putEvent({
  bus: 'advisory',
  targetService: 'compliance-ctrl',
  detailType: 'MANDATE_ISSUED',
  subject: { userId: 'u', mandateId: 'm', level: 'DISCRETIONARY' as const, status: 'ACTIVE' as const, operatingMode: 'BALANCED' as const, effectiveDate: '2026-01-15T00:00:00.000Z' },
}));

// --- unknown event name is a compile error ---
// @ts-expect-error — NOT_A_REAL_EVENT is not a RegisteredEventName, rejected by both overloads
use(eb.putEvent({
  bus: 'advisory',
  targetService: 'compliance-ctrl',
  detailType: 'NOT_A_REAL_EVENT',
  subject: { anything: true },
}));
