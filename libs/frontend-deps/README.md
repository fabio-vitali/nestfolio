# @nestfolio/frontend-deps

Single source of truth for the Native Federation singleton surface consumed by every frontend app in this workspace (shell + 5 MFEs).

## Exports

- `sharedFrontendDeps` — the result of `share({...})` over 23 singleton packages. Native Federation expands each entry into its primary key plus every subpath export (so the output object has more than 23 keys — that's expected).
- `sharedMappings` — the `['@nestfolio/ui', '@nestfolio/shell']` array consumed by `withNativeFederation`'s `sharedMappings` option.

## Usage

Every `apps/*/federation.config.js` imports both values and spreads them:

```js
const { withNativeFederation } = require('@angular-architects/native-federation/config');
const { sharedFrontendDeps, sharedMappings } = require('@nestfolio/frontend-deps');

module.exports = withNativeFederation({
  // ...app-specific name/exposes...
  shared: { ...sharedFrontendDeps },
  sharedMappings,
  skip: [],
});
```

## Invariant — enforced by construction

Native Federation requires the shell's singleton set to be a *superset* of every MFE's. Because every `federation.config.js` in the workspace spreads the same `sharedFrontendDeps`, the sets are **identical** — the superset relation holds trivially. Do not add ad-hoc `share({...})` blocks in any `federation.config.js`; add the dependency here instead. Drift is only possible by bypassing this module.

## Adding a new shared singleton

1. Ensure the package is in the root `package.json` `dependencies`.
2. Add a line to `sharedFrontendDeps` here: `'<package>': singletonOpts`.
3. Rebuild every app (`pnpm nx run-many -t build -p nestfolio-host,advisory-mfe,dashboard-mfe,investor-mfe,ledger-mfe,onboarding-mfe`).

## Why not `shareAll()`?

`@softarc/native-federation/config` exposes `shareAll()` which auto-declares every `dependencies` entry from the nearest `package.json`. Rejected for this monorepo because the root `package.json` is a union of frontend + backend deps — `shareAll()` would over-share. The hand-curated list here **is** the singleton contract.
