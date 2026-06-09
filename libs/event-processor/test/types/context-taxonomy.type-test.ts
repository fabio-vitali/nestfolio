/**
 * Type-level tests for the platform context taxonomy (phase-0).
 *
 * Validated by `pnpm nx run event-processor:typecheck` (tsc --noEmit against
 * tsconfig.type-test.json, which includes test/types/**). No runtime assertions:
 * a `@ts-expect-error` that does NOT error is itself a compile failure — that is
 * the test failing. The function-call `use(...)` idiom (mirroring
 * ownership.type-test.ts) keeps `noUnusedLocals` + lint's no-unused-expressions
 * satisfied without executing anything.
 */
import type {
  BusEvent,
  TableEntry,
  RequestContext,
  RegionContext,
  SubjectContext,
} from '../../src';

// Consumes values so nothing is reported as an unused local / unused expression.
declare function use(...xs: unknown[]): void;

// Sample subjects — pure business aggregates, no identity metainfo on the subject.
type TaxLot = { lotId: string; symbol: string };
type MarketSnapshot = { asOf: string; indices: number[] };
type SecFiling = { accession: string; form: string };

// --- the base accepts the concrete context types (both ARE SubjectContexts) ---
type ReqIsCtx = RequestContext extends SubjectContext ? true : false;
type RegIsCtx = RegionContext extends SubjectContext ? true : false;
const baseAssignable: [ReqIsCtx, RegIsCtx] = [true, true]; // both must resolve to `true`
use(baseAssignable);

// --- default S = RequestContext: a tenant-scoped row carries tenant identity + subject ---
declare const tenantRow: TableEntry<TaxLot>;
use(tenantRow.tenantId, tenantRow.userId, tenantRow.lotId, tenantRow.pk);

// --- region-scoped: carries `region`, but NOT tenant identity (no fake tenantId) ---
declare const regionRow: TableEntry<MarketSnapshot, RegionContext>;
use(regionRow.region, regionRow.asOf, regionRow.pk);
// @ts-expect-error — region-scoped rows must NOT carry tenantId
use(regionRow.tenantId);

// --- global: the bare base (SubjectContext) — no identity, and a CLOSED row ---
// (We deliberately use `SubjectContext`, not `Record<string, never>`: the latter has an
// index signature `[k: string]: never`, so `.tenantId` would resolve to `never` rather than
// erroring — defeating the "no identity" check. `SubjectContext` adds nothing and stays closed.)
declare const globalRow: TableEntry<SecFiling, SubjectContext>;
use(globalRow.accession, globalRow.form, globalRow.pk);
// @ts-expect-error — global rows carry no tenant identity
use(globalRow.tenantId);

// --- BusEvent mirrors TableEntry: same S options, context carried on the event ---
declare const regionEvent: BusEvent<MarketSnapshot, RegionContext>;
use(regionEvent.context.region, regionEvent.subject.asOf);
declare const tenantEvent: BusEvent<TaxLot>;
use(tenantEvent.context.tenantId, tenantEvent.subject.lotId);

// --- the constraint bites: a non-object S is rejected on BOTH generics ---
// @ts-expect-error — TableEntry's S must extend SubjectContext (object); string is not
type BadEntry = TableEntry<TaxLot, string>;
// @ts-expect-error — BusEvent's S must extend SubjectContext (object); number is not
type BadEvent = BusEvent<TaxLot, number>;
// Reference the aliases so neither is an unused declaration (optional-tuple, never constructed).
const badRefs: [BadEntry?, BadEvent?] = [];
use(badRefs);
