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
 *
 * NOT registered (intentional):
 *   - Deposit / Withdrawal → workstream 5 (externally-settled; become Projection<'P1'>).
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
  }
}

export {};
