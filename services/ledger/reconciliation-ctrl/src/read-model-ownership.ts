/**
 * reconciliation-ctrl read-model ownership registration (WS-D).
 *
 * Compile-time enforcement (see docs/architecture/READ-MODEL-OWNERSHIP.md):
 *   - ReconciliationResult / DriftRecord : CommandOwned rows reconciliation-ctrl
 *     computes from its own reconcile() logic, writes via record(), and reads
 *     back via getDriftRecords (read-your-own-writes). No other service projects
 *     the rows — consumers react to the emitted RECONCILIATION_COMPLETED /
 *     PORTFOLIO_DRIFT_DETECTED events. projectVersioned() on them must fail
 *     typecheck.
 */
import type { CommandOwned } from '@nestfolio/event-processor';

declare module '@nestfolio/event-processor' {
  interface ReadModelOwnership {
    ReconciliationResult: CommandOwned;
    DriftRecord: CommandOwned;
  }
}

export {};
