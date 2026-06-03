/**
 * Compile-time proof that compliance-ctrl's ownership registration rejects the
 * wrong write intents. A `@ts-expect-error` that does NOT error is itself a
 * compile failure. Verified by `nx run compliance-ctrl:typecheck`.
 */
import { project, accumulate, projectVersioned, record, update } from '@nestfolio/event-processor';
import '../../src/read-model-ownership';

// P2 append-logs: record() is the blessed write.
record('ComplianceCheck', { a: 1 });
record('AuditArtifact', { a: 1 });

// @ts-expect-error — projectVersioned on a P2 append-log must not typecheck
projectVersioned('ComplianceCheck', { a: 1 }, { version: 1 });
// @ts-expect-error — project on a P2 projection must not typecheck
project('ComplianceCheck', { a: 1 });
// @ts-expect-error — accumulate on a P2 projection must not typecheck
accumulate('AuditArtifact', { field: 'count', increment: 1 });
// @ts-expect-error — update (command write) on a P2 projection must not typecheck
update('ComplianceCheck', { a: 1 });
// @ts-expect-error — projectVersioned on a P2 append-log must not typecheck
projectVersioned('AuditArtifact', { a: 1 }, { version: 1 });
// @ts-expect-error — project on a P2 projection must not typecheck
project('AuditArtifact', { a: 1 });
// @ts-expect-error — accumulate on a P2 projection must not typecheck
accumulate('ComplianceCheck', { field: 'count', increment: 1 });
// @ts-expect-error — update (command write) on a P2 projection must not typecheck
update('AuditArtifact', { a: 1 });

// MandateSnapshot is P1 — projectVersioned only.
projectVersioned('MandateSnapshot', { a: 1 }, { version: 1 });
// @ts-expect-error — update (command write) on a P1 projection must not typecheck
update('MandateSnapshot', { a: 1 });
// @ts-expect-error — record on a P1 projection must not typecheck
record('MandateSnapshot', { a: 1 });
// @ts-expect-error — project (unversioned) on a P1 projection must not typecheck
project('MandateSnapshot', { a: 1 });
// @ts-expect-error — accumulate on a P1 projection must not typecheck
accumulate('MandateSnapshot', { field: 'count', increment: 1 });

export {};
