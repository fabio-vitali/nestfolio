/**
 * Compile-time proof that investor-bff's ReadModelOwnership registration enforces
 * the intent×typename rules. Verified by: pnpm nx run investor-bff:typecheck
 * (tsc --noEmit -p tsconfig.type-test.json). Every @ts-expect-error MUST fire.
 */
import { project, accumulate, update, record, projectVersioned } from '@nestfolio/event-processor';
import '../../src/read-model-ownership';

// CashBalance is P1 — projectVersioned is the only blessed write.
projectVersioned('CashBalance', { cashBalanceCents: 1 }, { version: 1 });
// @ts-expect-error P1 row cannot be written with unconditional project()
project('CashBalance', { cashBalanceCents: 1 });
// @ts-expect-error P1 row cannot be accumulated
accumulate('CashBalance', { field: 'cashBalanceCents', increment: 1 });
// @ts-expect-error P1 row cannot be field-updated
update('CashBalance', { cashBalanceCents: 1 });
// @ts-expect-error P1 row cannot be append-recorded
record('CashBalance', { cashBalanceCents: 1 });

// CommandOwned rows — record() (one-event seed) and update() (field writes) allowed.
record('Notification', { notificationId: 'n1' });
update('InvestorProfile', { operatingMode: 'BALANCED' });
update('Mandate', { status: 'REVOKED' });
// @ts-expect-error a command-owned row is not a versioned projection
projectVersioned('InvestorProfile', { a: 1 }, { version: 1 });
// @ts-expect-error a command-owned row is not a versioned projection
projectVersioned('Mandate', { a: 1 }, { version: 1 });

// FeatureFlag is CommandOwned (command-written system flag) — record() seed allowed.
record('FeatureFlag', { name: 'confirmDecision', enabled: true });
// @ts-expect-error a command-owned row is not a versioned projection
projectVersioned('FeatureFlag', { name: 'confirmDecision', enabled: true }, { version: 1 });

export {};
