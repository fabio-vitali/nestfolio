# Domain Isolation & Service Boundaries Design

## Problem

Services currently import event types across domain boundaries freely via `@nestfolio/*/domain` barrels. There is no enforcement of domain isolation at the TypeScript/lint level. With domains potentially deployable in different AWS accounts/regions, cross-domain communication needs explicit boundaries:

- **In-domain**: services within the same domain share types freely
- **Cross-domain**: communication goes through adapter services that define the cross-domain contract

## Architecture

### Two-Level Isolation Model

```
┌─────────────────────── Domain ────────────────────────────┐
│                                                            │
│  service-bff ──┐                                           │
│  service-ctrl ─┤── in-domain bus ──► domain-adpt ─────────►│──► external buses
│  other-ctrl ───┘   (@nestfolio/*/service)   │              │
│                                             │              │
│                    ◄── cross-domain ◄───────┘              │
│                    (@nestfolio/*-adpt/domain)               │
└────────────────────────────────────────────────────────────┘
```

- **`/service` barrels**: In-domain types (events, schemas, models). Importable only by services with the same `scope:` tag.
- **`/domain` barrels**: Cross-domain event contracts (subset types). Only on adapter services. Importable by any domain via `allow` rule.

### Component Roles

| Component | Role |
|-----------|------|
| **Hub stacks** | Bus creation, event archive, SSM params, resource policies. No forwarding rules. |
| **Adapter stacks** | CDK-only (no Lambda). Outbound EventBridge forwarding rules from domain bus to external buses. `/domain` barrel defines cross-domain type contract. |
| **Service stacks** | Business logic. Ingress (consumer-deploys-rule), Egress (DDB Streams → bus). `/service` barrel for in-domain types. |
| **broker-adpt** | Renamed from `execution-adpt`. External IBKR broker integration. `scope:execution`. |

### Cross-Domain Communication Flow

**Outbound**: Internal service publishes event → domain bus → adapter forwarding rule → external domain bus. Pure EventBridge rule forwarding (no Lambda transformation). Same event names cross-domain.

**Inbound**: External adapter forwards to domain bus → internal service consumes via Ingress. Consumer imports cross-domain type from source domain's adapter (`@nestfolio/<source>-adpt/domain`).

### Cross-Domain Event Contracts

Adapters define subset TypeScript types (Pick/Omit of internal schemas). No runtime transformation — contract is enforced at the TypeScript level only. Event `detailType` names are the same as internal events.

**investor-adpt outbound** (from investor-hub ToAdvisory + ToExecution):

| Event | Target Domains |
|-------|---------------|
| `GOAL_UPDATED` | advisory |
| `RISK_PROFILE_UPDATED` | advisory |
| `OPERATING_MODE_CHANGED` | advisory |
| `MANDATE_GRANTED` | advisory |
| `MANDATE_UPDATED` | advisory |
| `MANDATE_REVOKED` | advisory |
| `DEPOSIT_INITIATED` | execution |
| `WITHDRAWAL_REQUESTED` | execution |
| `ACCOUNT_CLOSURE_REQUESTED` | execution |

**advisory-adpt outbound** (from advisory-hub ToInvestor + ToExecution):

| Event | Target Domains |
|-------|---------------|
| `DECISION_PACKET_CREATED` | investor, execution |
| `USER_CONFIRMATION_REQUESTED` | investor |
| `EXPLANATION_GENERATED` | investor |
| `DECISION_APPROVED` | investor, execution |
| `DECISION_BLOCKED` | investor |
| `ESCALATION_TRIGGERED` | investor |
| `USER_CONFIRMED` | execution |
| `CIRCUIT_BREAKER_TRIGGERED` | investor, execution |
| `CIRCUIT_BREAKER_RESET` | investor, execution |
| `INCIDENT_DETECTED` | investor |
| `INCIDENT_RESOLVED` | investor |

**execution-adpt outbound** (from execution-hub ToInvestor + ToAdvisory + ToLedger):

| Event | Target Domains |
|-------|---------------|
| `ORDER_STAGED` | investor |
| `ORDER_FILLED` | ledger, advisory |
| `ORDER_PARTIALLY_FILLED` | ledger |
| `ORDER_REJECTED` | investor, ledger, advisory |
| `ORDER_CANCELLED` | investor, ledger, advisory |
| `DEPOSIT_DETECTED` | ledger, advisory |
| `WITHDRAWAL_COMPLETED` | ledger |
| `WITHDRAWAL_REJECTED` | investor |
| `PORTFOLIO_DRIFT_DETECTED` | advisory |
| `BROKER_SESSION_LOST` | advisory |
| `STREAM_DISCONNECTED` | advisory |
| `RECONCILIATION_FAILED` | advisory |
| `CORPORATE_ACTION_APPLIED` | ledger |
| `PORTFOLIO_SNAPSHOT_IMPORTED` | ledger |

**ledger-adpt outbound** (from ledger-hub ToInvestor + ToAdvisory):

| Event | Target Domains |
|-------|---------------|
| `BALANCE_UPDATED` | investor |
| `PORTFOLIO_UPDATED` | investor, advisory |
| `LEDGER_ENTRY_RECORDED` | investor |
| `LEDGER_PROCESSING_FAILED` | investor |
| `RECONCILIATION_COMPLETED` | investor |
| `RECONCILIATION_FAILED` | investor, advisory |
| `PORTFOLIO_DRIFT_DETECTED` | advisory |

## Enforce-Module-Boundaries Configuration

```js
'@nx/enforce-module-boundaries': ['error', {
  enforceBuildableLibDependency: false,
  allow: [
    '@nestfolio/.+-adpt/domain',  // cross-domain contracts (any scope)
    '@nestfolio/event-processor',  // core platform lib (jest.mock compat)
    '@nestfolio/agent-core',       // agent lib (jest.mock compat)
  ],
  depConstraints: [
    { sourceTag: 'scope:platform', onlyDependOnLibsWithTags: ['scope:platform'] },
    { sourceTag: 'scope:shared', onlyDependOnLibsWithTags: ['scope:shared', 'scope:platform'] },
    { sourceTag: 'scope:domain', onlyDependOnLibsWithTags: ['scope:domain', 'scope:platform'] },
    { sourceTag: 'scope:investor', onlyDependOnLibsWithTags: ['scope:investor', 'scope:platform', 'scope:shared'] },
    { sourceTag: 'scope:advisory', onlyDependOnLibsWithTags: ['scope:advisory', 'scope:platform', 'scope:shared'] },
    { sourceTag: 'scope:execution', onlyDependOnLibsWithTags: ['scope:execution', 'scope:platform', 'scope:shared'] },
    { sourceTag: 'scope:ledger', onlyDependOnLibsWithTags: ['scope:ledger', 'scope:platform', 'scope:shared'] },
    { sourceTag: 'scope:shell', onlyDependOnLibsWithTags: ['scope:shell', 'scope:shared'] },
  ],
}]
```

**Key rule**: `allow: ['@nestfolio/.+-adpt/domain']` — only adapter `/domain` barrels cross scope boundaries. All `/service` barrels are constrained by `depConstraints`.

## Adapter Service Structure

Each adapter follows this structure:

```
<domain>-adpt/
├── project.json              # tags: scope:<domain>, type:adpt
├── tsconfig.json
├── src/
│   ├── domain/
│   │   ├── index.ts          # cross-domain barrel (subset types)
│   │   ├── events.ts         # re-exports event type constants from internal services
│   │   └── schemas.ts        # subset Zod schemas (Pick<> of internal schemas)
│   └── service.stack.ts      # CDK: forwarding rules from domain bus → external buses
```

No Lambda handlers. Pure CDK infrastructure for EventBridge rule forwarding.

## File & Path Changes

### Barrel Rename

All 9 existing service barrels rename:
- Directory: `src/domain/` → `src/service-domain/`
- tsconfig path: `@nestfolio/<service>/domain` → `@nestfolio/<service>/service`

### New tsconfig Paths

```json
"@nestfolio/investor-adpt/domain": ["services/investor/investor-adpt/src/domain/index.ts"],
"@nestfolio/advisory-adpt/domain": ["services/advisory/advisory-adpt/src/domain/index.ts"],
"@nestfolio/execution-adpt/domain": ["services/execution/execution-adpt/src/domain/index.ts"],
"@nestfolio/ledger-adpt/domain": ["services/ledger/ledger-adpt/src/domain/index.ts"]
```

### Service Rename

`execution-adpt` → `broker-adpt` (scope:execution, type:adpt — external IBKR integration)

### Hub Stack Simplification

Remove all forwarding rules from investor-hub, advisory-hub, execution-hub, ledger-hub. Keep: bus, archive, SSM params.

## Import Rewiring Rules

1. **In-domain import** (same scope): `@nestfolio/<service>/domain` → `@nestfolio/<service>/service`
2. **Cross-domain import** (different scope): `@nestfolio/<service>/domain` → `@nestfolio/<source-domain>-adpt/domain`

Example — execution-ctrl currently:
```ts
import { ComplianceEventTypes } from '@nestfolio/compliance-ctrl/domain';
import { AdvisoryBffEventTypes } from '@nestfolio/advisory-bff/domain';
```

After migration:
```ts
import { ComplianceEventTypes } from '@nestfolio/advisory-adpt/domain';
import { AdvisoryBffEventTypes } from '@nestfolio/advisory-adpt/domain';
```

## Cross-Domain Data Types

Some services import **data types** (not just event constants) cross-domain. These must also be included in the adapter `/domain` barrels as subset types.

Known cross-domain type dependencies:
- `execution-ctrl` imports `ProposedTrade` from `@nestfolio/advisory-ctrl/domain` (used in order.repository.ts, safety-checks.service.ts, order-lifecycle.service.ts) → must be re-exported in `advisory-adpt/domain`

The adapter `/domain` barrel should export both event type constants/schemas AND any data types that cross-domain consumers need.

## Scope Tag Corrections

The following scope tags need correction before enforcement:
- `ledger-mfe`: currently `scope:execution` → should be `scope:ledger` (it pairs with ledger-bff)
- `dashboard-mfe`: currently `scope:dashboard` → should be `scope:investor` (it pairs with dashboard-bff in investor domain)

After correction, the `scope:dashboard` constraint can be removed from depConstraints.

## Implementation Waves

1. **Wave 1**: Rename `execution-adpt` → `broker-adpt` (must happen before Wave 3 to avoid name collision with new `execution-adpt`)
2. **Wave 2**: Rename all `/domain` barrels → `/service` + update tsconfig paths + rewrite all imports. Keep permissive `allow: ['@nestfolio/.+/service']` temporarily.
3. **Wave 3**: Create 4 adapter services with `/domain` barrels (cross-domain subset types including data types like `ProposedTrade`) + new tsconfig paths
4. **Wave 4**: Rewire cross-domain imports from `@nestfolio/<service>/service` to `@nestfolio/<domain>-adpt/domain`
5. **Wave 5**: Move forwarding rules from hub stacks to adapter stacks
6. **Wave 6**: Fix scope tags (ledger-mfe, dashboard-mfe). Update eslint.config.js with final enforce-module-boundaries rules (tighten `allow` to `@nestfolio/.+-adpt/domain`).
7. **Wave 7**: Verify — `nx run-many -t lint` with zero boundary violations

**Note on intermediate state**: During Waves 2-4, the `allow` regex in eslint.config.js must remain permissive (`@nestfolio/.+/service`) to avoid lint failures on not-yet-rewired cross-domain imports. It is tightened to `@nestfolio/.+-adpt/domain` only in Wave 6 after all imports are rewired.

## Decisions Log

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Domain-boundary adapter vs external-system adapter | Separate service types | execution-adpt (IBKR) renamed to broker-adpt; new domain-adpt per domain |
| Forwarding rules ownership | Adapter stacks | Hubs stay thin infra; adapters own outbound forwarding |
| Hub stack role after migration | Bus + archive + SSM + resource policies | No forwarding rules |
| Inbound cross-domain consumption | Direct (option 2) | No inbound transformation; consumers import from source adapter's /domain barrel |
| Cross-domain event naming | Same as internal names | Simplicity; no rename mapping needed |
| Runtime transformation | None (pure forwarding) | TypeScript-level contract only; can add Lambda transformation later for cross-account |
| Two isolation levels | /service (in-domain) + /domain (cross-domain adapters only) | Enforced via Nx module boundaries + allow regex |
