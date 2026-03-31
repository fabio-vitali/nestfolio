# C4 Frontend Representation — Design Spec

**Date:** 2026-03-31
**Scope:** C1 + C2 changes only (no C3 Angular-level detail)

## Problem

The C4 diagrams represent the backend architecture well but the frontend is nearly invisible:

- **C1**: A single "Investor User" person connects directly to the Investor Domain. No frontend layer shown.
- **C2**: `investor-web` appears in the Investor domain as a CDK infrastructure stack (CloudFront/S3/Cognito). The 5 MFEs (investor, dashboard, onboarding, advisory, ledger) are not represented. No MFE↔BFF connections are visible.
- The federated SPA architecture — 5 micro-frontends loaded into a shell host, each talking to a dedicated BFF via GraphQL — is completely absent from the diagrams.

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| C4 levels | C1 + C2 only | Stays consistent with current backend depth; Angular internals aren't infrastructure |
| C1 placement | Web App **inside** system boundary | It's part of the system (deployed via CDK), follows C4 convention for SPAs |
| C2 granularity | Individual MFE boxes per domain | Makes MFE↔BFF pairing visible at a glance |
| `investor-web` | **Remove** from C2 | MFE green boxes supersede the CDK infra box; CloudFront/S3 is plumbing |
| Discovery | Auto-discover from federation configs + host routes | Code is source of truth; won't go stale |

## C1 — System Context Changes

### Add "Nestfolio Web App" node

- **Shape:** Rectangle with `frontend` class (green: `#81C784` fill, `#4CAF50` stroke)
- **Label:** "Nestfolio Web App"
- **Subtitle:** "[Angular PWA / Native Federation]"
- **Position:** Inside the system boundary, between the Investor User and the domain boxes
- **Not clickable** — no C2 drill-down (MFEs appear in domain C2 views instead)

### Replace user↔domain edge

Remove:
```
investor-user <-> nestfolio.investor-domain
```

Add:
```
investor-user -> nestfolio.web-app           # "Uses"
nestfolio.web-app -> nestfolio.investor-domain   # "GraphQL"
nestfolio.web-app -> nestfolio.advisory-domain   # "GraphQL"
nestfolio.web-app -> nestfolio.ledger-domain     # "GraphQL"
```

Execution domain has no frontend — no edge from web-app.

## C2 — Domain View Changes

### MFE nodes per domain

Each MFE appears as a green `frontend`-class box in its domain's C2 view, with a GraphQL edge to its BFF.

| Domain | MFEs Added | GraphQL edges to | Removed |
|--------|-----------|-----------------|---------|
| Investor | investor-mfe, dashboard-mfe, onboarding-mfe | investor-bff, dashboard-bff, onboarding-bff | investor-web |
| Advisory | advisory-mfe | advisory-bff | — |
| Ledger | ledger-mfe | ledger-bff | — |
| Execution | — | — | — |

### MFE node styling

- **Class:** `frontend` (already defined in global styles)
- **Label:** Title-case with "MFE" suffix: "Investor MFE", "Dashboard MFE", etc.
- **Subtitle:** "[Micro-Frontend]"
- **Tooltip:** From `apps/{mfe}/README.md` if it exists, otherwise a generated description
- **No `link` property** — MFEs don't have C3 drill-down

### GraphQL edges

- **Style:** Solid stroke, green color (`#4CAF50`), width 2
- **Label:** "GraphQL"
- **Direction:** MFE → BFF

### Remove `investor-web`

- Suppress `investor-web` from C2 service classification (it's a CDK-discovered "frontend" with Distribution)
- Remove its C3 layer import from the Investor domain
- Delete `c3/investor-web.d2` from generated output

## Discovery Mechanism

New `discoverMfes()` function in `generate-c4-sources.mjs`:

### Step 1: Find MFE apps

Scan `apps/*/federation.config.js`. Each file that exports an `exposes` property (containing `'./routes'`) is an MFE. The host app does NOT export `exposes`.

### Step 2: Parse host routes

Read `apps/nestfolio-host/src/app/app.routes.ts`. Extract pairs via regex:

```
loadMfe('mfe-name', './routes')    →  mfe name
provideGraphqlFor('bffName')       →  BFF name (camelCase)
```

A route may have `loadMfe` without `provideGraphqlFor` (e.g., onboarding-mfe).

### Step 3: Map BFF → domain

Convert camelCase BFF name to kebab-case (`investorBff` → `investor-bff`). Look up `services/{domain}/{bff-name}/` to resolve the domain.

### Step 4: Fallback for no-GraphQL MFEs

If a route has `loadMfe` but no `provideGraphqlFor`, match by name prefix: `onboarding-mfe` → look for `onboarding-bff` in the discovered services.

### Return type

```js
[{ mfe: string, bff: string, domain: string, route: string }]
```

Example:
```js
[
  { mfe: 'investor-mfe',    bff: 'investor-bff',    domain: 'investor', route: '/investor' },
  { mfe: 'dashboard-mfe',   bff: 'dashboard-bff',   domain: 'investor', route: '/dashboard' },
  { mfe: 'onboarding-mfe',  bff: 'onboarding-bff',  domain: 'investor', route: '/onboarding' },
  { mfe: 'advisory-mfe',    bff: 'advisory-bff',    domain: 'advisory', route: '/advisory' },
  { mfe: 'ledger-mfe',      bff: 'ledger-bff',      domain: 'ledger',   route: '/ledger' },
]
```

## Generator Changes

### `generate-c4-sources.mjs`

#### New function: `discoverMfes()`

As described above. Exported for testing.

#### Modified: `generateC1(domains, mfes)`

- Accept `mfes` parameter (output of `discoverMfes()`)
- Add `web-app` node with `frontend` class inside the system boundary
- Derive connected domains from `mfes` (unique domain set)
- Emit edges: `investor-user → web-app`, `web-app → {connected domains}`
- Remove old `investor-user ↔ investor-domain` edge

#### Modified: `generateC2(domain, services, parsedStacks, mfes)`

- Accept `mfes` parameter (filtered to this domain)
- For each MFE: emit a `frontend`-class node + "GraphQL" edge to its BFF
- Suppress `investor-web` from service list (skip services classified as "frontend" that have a CDK Distribution)

#### Modified: main orchestration

- Call `discoverMfes()` alongside `discoverServices()`
- Pass MFE data to `generateC1()` and `generateC2()`
- Skip C3 generation for suppressed frontend services (`investor-web`)

### `generate-c4-diagrams.mjs`

No changes needed — SVG post-processing is format-agnostic.

## Test Changes

Add tests to `test/tools/generate-c4-sources.test.mjs`:

- `discoverMfes()` returns 5 MFEs with correct domain/BFF mappings
- `generateC1()` includes `web-app` node with edges to 3 domains
- `generateC1()` does NOT include direct `investor-user ↔ investor-domain` edge
- `generateC2('investor', ...)` includes 3 MFE nodes with GraphQL edges
- `generateC2('advisory', ...)` includes 1 MFE node
- `generateC2('ledger', ...)` includes 1 MFE node
- `generateC2('execution', ...)` includes 0 MFE nodes
- `investor-web` is excluded from C2 Investor domain
- `c3/investor-web.d2` is not generated

## Out of Scope

- C3 Angular-level diagrams (component breakdown, shared libs, state management)
- Shell host (`nestfolio-host`) as a visible node — it's deployment infrastructure
- MFE-to-MFE communication (none exists currently)
- Shared library visualization (`@nestfolio/shell`, `@nestfolio/ui`)
