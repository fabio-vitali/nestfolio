/**
 * compliance-ctrl read-model ownership registration (WS-A).
 *
 * Compile-time enforcement (see docs/architecture/READ-MODEL-OWNERSHIP.md):
 *   - ComplianceCheck / AuditArtifact : P2 append-logs → record() only
 *     (projectVersioned / project / accumulate / update fail typecheck).
 */
import type { Projection } from '@nestfolio/event-processor';

declare module '@nestfolio/event-processor' {
  interface ReadModelOwnership {
    ComplianceCheck: Projection<'P2'>;
    AuditArtifact: Projection<'P2'>;
  }
}

export {};
