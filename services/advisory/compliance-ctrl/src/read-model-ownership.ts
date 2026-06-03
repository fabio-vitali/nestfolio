/**
 * compliance-ctrl read-model ownership registration.
 *
 * Compile-time enforcement (see docs/architecture/READ-MODEL-OWNERSHIP.md):
 *   - ComplianceCheck / AuditArtifact : P2 append-logs → record() only.
 *   - MandateSnapshot : P1 mirror of the investor-bff Mandate aggregate →
 *     projectVersioned only, keyed on the Mandate __version carried by CDC.
 */
import type { Projection } from '@nestfolio/event-processor';

declare module '@nestfolio/event-processor' {
  interface ReadModelOwnership {
    ComplianceCheck: Projection<'P2'>;
    AuditArtifact: Projection<'P2'>;
    MandateSnapshot: Projection<'P1'>;
  }
}

export {};
