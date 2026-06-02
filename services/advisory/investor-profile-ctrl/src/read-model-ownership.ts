/**
 * investor-profile-ctrl read-model ownership registration (WS-A).
 *
 * Compile-time enforcement (see docs/architecture/READ-MODEL-OWNERSHIP.md):
 *   - InvestorProfileSnapshot : CommandOwned own-aggregate (written via
 *     update() upsert + atomic __version) → projectVersioned fails typecheck.
 * The decision-workflow-ctrl MIRROR is registered Projection<'P1'> in WS-C.
 */
import type { CommandOwned } from '@nestfolio/event-processor';

declare module '@nestfolio/event-processor' {
  interface ReadModelOwnership {
    InvestorProfileSnapshot: CommandOwned;
  }
}

export {};
