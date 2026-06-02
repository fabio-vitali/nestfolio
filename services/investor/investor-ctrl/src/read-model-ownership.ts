/**
 * investor-ctrl read-model ownership registration (WS-A).
 *
 * Compile-time enforcement (see docs/architecture/READ-MODEL-OWNERSHIP.md):
 *   - Notification / MonthlyReport : CommandOwned (seeded by one idempotent
 *     event via record()) → projectVersioned fails typecheck.
 * Notification is also a CommandOwned read-model row in investor-bff; the same
 * tag in both services is correct CQRS (producer copy + read-model copy) and
 * raises no registry conflict.
 */
import type { CommandOwned } from '@nestfolio/event-processor';

declare module '@nestfolio/event-processor' {
  interface ReadModelOwnership {
    Notification: CommandOwned;
    MonthlyReport: CommandOwned;
  }
}

export {};
