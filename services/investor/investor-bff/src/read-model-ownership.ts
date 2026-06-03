/**
 * investor-bff read-model ownership registration (workstream 4).
 *
 * Opting these typenames into @nestfolio/event-processor's ReadModelOwnership
 * registry turns on compile-time enforcement (see docs/architecture/READ-MODEL-OWNERSHIP.md):
 *   - CashBalance : P1 — ledger is the external authority; projectVersioned only
 *     (project/accumulate/update/record on it fail typecheck).
 *   - InvestorProfile / Mandate / Notification : CommandOwned — driven by local
 *     commands after a one-event seed; field-level update() + record() seed are
 *     allowed, projectVersioned on them fails typecheck.
 *   - Deposit / WithdrawalRequest : P1 — broker-ctrl owns the funding lifecycle
 *     and emits versioned snapshots; investor-bff projects them via
 *     projectVersioned only (project/accumulate/update/record fail typecheck).
 *   - DepositIntent / WithdrawalIntent : CommandOwned — outbox rows written by
 *     the deposit/withdrawal resolvers; CDC egress emits the *_INITIATED events
 *     from them (the intent-outbox model — see workstream 5).
 *   - FeatureFlag : CommandOwned — system flag store written only by the
 *     updateFeatureFlag AppSync resolver (and the circuit-breaker IAM-signed
 *     mutation), read by getFeatureFlags + the onFeatureFlagUpdate subscription.
 *     Documentary registration (command write, not an intent factory — WS-D).
 *
 * NOT registered (intentional):
 *   - ExecutionModeChange → write-once audit row, never written via an intent and
 *     never projected; registration would be inert.
 */
import type { Projection, CommandOwned } from '@nestfolio/event-processor';

declare module '@nestfolio/event-processor' {
  interface ReadModelOwnership {
    CashBalance: Projection<'P1'>;
    InvestorProfile: CommandOwned;
    Mandate: CommandOwned;
    Notification: CommandOwned;
    Deposit: Projection<'P1'>;
    WithdrawalRequest: Projection<'P1'>;
    DepositIntent: CommandOwned;
    WithdrawalIntent: CommandOwned;
    FeatureFlag: CommandOwned;
  }
}

export {};
