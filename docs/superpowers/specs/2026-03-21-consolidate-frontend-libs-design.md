# Design: Consolidate Frontend Libs & Rename agent-core

**Date:** 2026-03-21
**Status:** Draft
**Scope:** 5 frontend libs → 2, rename agent-core → agent-orchestrator

## Problem

The frontend has 5 libraries (auth, shared-state, i18n, ui-components, appsync-client) consumed by 1 shell + 4 MFEs. This creates unnecessary overhead:
- 5 `project.json`, 5 `jest.config`, 5 `tsconfig.json` sets to maintain
- Every `federation.config.js` lists all 5 as `sharedMappings`
- Every app `jest.config.ts` has 5+ `moduleNameMapper` entries
- Only 1 cross-lib dependency exists (appsync-client → shared-state)
- Total: 44 source files + 33 test files across 5 libs — small enough to consolidate

Additionally, `agent-core` has a misleading name (it's LangGraph orchestration infra, not generic "core") and wrong scope tag (`scope:domain` should be `scope:platform`).

## Design

### 1. Frontend: 5 libs → 2

#### `@nestfolio/shell` (new)

Absorbs: `auth` + `shared-state` + `i18n` + `appsync-client`

All runtime services, state management, data access, and cross-cutting concerns — the "invisible" layer.

**Internal structure:**
```
libs/shell/
  src/
    auth/
      auth-interceptor-state.service.ts
      auth.config.ts
      auth.guard.ts
      auth.interceptor.ts
      auth.provider.ts
      auth.service.ts
      index.ts                    ← subpath barrel
    graphql/
      appsync.config.ts
      cached-query.ts
      graphql.service.ts
      index.ts                    ← subpath barrel
    i18n/
      assets/
        en-GB.json
        it-IT.json
      i18n.provider.ts
      i18n.service.ts
      index.ts                    ← subpath barrel
    errors/
      parse-error.ts
    features/
      with-call-state.ts
      with-devtools.ts
      with-logout-reset.ts
    stores/
      auth.store.ts
      notification.store.ts
      tenant.store.ts
      ui.store.ts
    global-error-handler.ts
    logger.service.ts
    logout-orchestrator.ts
    models.ts
    index.ts                      ← main barrel
  test/
    auth/
      auth.guard.spec.ts
      auth.interceptor.spec.ts
      auth.service.test.ts
    graphql/
      appsync-config.test.ts
      cached-query.test.ts
      graphql.service.test.ts
    i18n/
      i18n.service.test.ts
    errors/
      parse-error.test.ts
    features/
      with-call-state.test.ts
      with-devtools.test.ts
      with-logout-reset.test.ts
    stores/
      auth.store.test.ts
      notification.store.test.ts
      tenant.store.test.ts
      ui.store.test.ts
    logger.service.spec.ts
    logout-orchestrator.spec.ts
    testing/
      index.ts                    ← test helpers (setupComponentTest, createMockI18nService, etc.)
      index.test.ts
    test-setup.ts
  project.json
  tsconfig.json
  tsconfig.lib.json
  tsconfig.spec.json
  jest.config.ts
```

**Import mapping (old → new):**

| Old import | New import |
|---|---|
| `from '@nestfolio/auth'` | `from '@nestfolio/shell/auth'` |
| `from '@nestfolio/shared-state'` | `from '@nestfolio/shell'` |
| `from '@nestfolio/shared-state/testing'` | `from '@nestfolio/shell/testing'` |
| `from '@nestfolio/i18n'` | `from '@nestfolio/shell/i18n'` |
| `from '@nestfolio/appsync-client'` | `from '@nestfolio/shell/graphql'` |

**Main barrel (`@nestfolio/shell`)** re-exports current shared-state public API:
- Stores: `AuthStore`, `TenantStore`, `UiStore`, `NotificationStore`
- Features: `withCallState`, `setLoading`, `setLoaded`, `setError`, `withDevtools`, `withLogoutReset`
- Services: `LoggerService`, `GlobalErrorHandler`, `LogoutOrchestrator`
- Utilities: `parseError`, `isGraphQLErrorResponse`
- Models/types: `UserProfile`, `TenantContext`, `AuthStatus`, `ThemeMode`

Note: `Locale` type is currently defined in shared-state `models.ts` and re-exported by i18n. After consolidation, the canonical definition stays in the main barrel (`@nestfolio/shell`). The `@nestfolio/shell/i18n` subpath re-exports it from the main barrel for convenience — single source of truth, two access paths.

**Subpath barrels:**
- `@nestfolio/shell/auth`: `authSignIn`, `authSignUp`, `authConfirmSignUp`, `authSignOut`, `getAuthSession`, `forceRefreshSession`, `getAuthUser`, `isAuthenticated`, `authGuard`, `authInterceptor`, `AuthInterceptorState`, `provideAuth`, `AuthConfig`, `AuthTokens`, `AuthUser`, `SignUpInput`
- `@nestfolio/shell/i18n`: `I18nService`, `Locale`, `provideI18n`
- `@nestfolio/shell/graphql`: `GraphqlService`, `CachedQuery`, `AppSyncConfig`, `APPSYNC_CONFIG`
- `@nestfolio/shell/testing`: `setupComponentTest`, `createMockI18nService`, `createMockRouter`, `createMockGraphqlService`

**tsconfig.base.json paths:**
```json
"@nestfolio/shell": ["libs/shell/src/index.ts"],
"@nestfolio/shell/testing": ["libs/shell/test/testing/index.ts"],
"@nestfolio/shell/*": ["libs/shell/src/*/index.ts"]
```

Note: `@nestfolio/shell/testing` must be listed before the wildcard `@nestfolio/shell/*` in tsconfig to take precedence (TypeScript resolves in declaration order).

**Jest config:** Single jest.config.ts with `testEnvironment: jsdom`. The graphql tests (3 files) currently use `testEnvironment: node` — they must be validated under jsdom as an explicit step before merging. These tests mock `@angular/core` manually and don't use DOM or Node-specific APIs, so jsdom should work. Fallback: add `/** @jest-environment node */` docblock to individual test files if any break.

**project.json tags:** `["scope:shared", "type:lib"]`

---

#### `@nestfolio/ui` (new)

Absorbs: `ui-components` (renamed + flattened)

Presentational components, pipes, and theme — the "visible" layer.

**Internal structure:**
```
libs/ui/
  src/
    layout/
      bottom-nav.component.ts
      header.component.ts
      shell-layout.component.ts
      sidebar.component.ts
    shared/
      agent-badge/agent-badge.component.ts
      badge/status-badge.component.ts
      empty-state/empty-state.component.ts
      expandable/expandable.component.ts
      loading-skeleton/loading-skeleton.component.ts
      pipes/
        currency-format.pipe.ts
        percent-format.pipe.ts
        relative-time.pipe.ts
    theme/
      nestfolio-preset.ts
      provide-theme.ts
    index.ts
  test/
    layout/
      bottom-nav.component.spec.ts
      header.component.spec.ts
      sidebar.component.spec.ts
    shared/
      agent-badge/agent-badge.component.spec.ts
      badge/status-badge.component.spec.ts
      empty-state/empty-state.component.spec.ts
      expandable/expandable.component.spec.ts
      loading-skeleton/loading-skeleton.component.spec.ts
      pipes/
        currency-format.pipe.spec.ts
        percent-format.pipe.spec.ts
        relative-time.pipe.spec.ts
    test-setup.ts
  project.json
  tsconfig.json
  tsconfig.lib.json
  tsconfig.spec.json
  jest.config.ts
```

Drops the unnecessary `src/lib/` nesting from ui-components.

**Import mapping:** `from '@nestfolio/ui-components'` → `from '@nestfolio/ui'`

All exports remain the same: `ShellLayoutComponent`, `HeaderComponent`, `SidebarComponent`, `BottomNavComponent`, `NavItem`, `CurrencyFormatPipe`, `PercentFormatPipe`, `RelativeTimePipe`, `StatusBadgeComponent`, `BadgeSeverity`, `EmptyStateComponent`, `LoadingSkeletonComponent`, `ExpandableComponent`, `AgentBadgeComponent`, `NestfolioPreset`, `provideNestfolioTheme`, `UiTheme`.

**tsconfig.base.json paths:**
```json
"@nestfolio/ui": ["libs/ui/src/index.ts"]
```

**project.json tags:** `["scope:shared", "type:lib"]`

---

### 2. Backend: Rename agent-core → agent-orchestrator

- Rename directory: `libs/agent-core/` → `libs/agent-orchestrator/`
- Update `project.json`: name to `agent-orchestrator`, fix tag `scope:domain` → `scope:platform`
- Update tsconfig path: `@nestfolio/agent-core` → `@nestfolio/agent-orchestrator`, same for wildcard
- Update all consumer imports (7 services: advisory-ctrl, advisory-narrative-ctrl, decision-workflow-ctrl, investor-profile-ctrl, market-intelligence-ctrl, portfolio-engine-ctrl, onboarding-agent-bff)

No internal restructuring — agent-core's internals are well-organized.

---

### 3. Config updates (all apps)

#### federation.config.js (5 files: nestfolio-host + 4 MFEs)

```js
// Before
sharedMappings: ['@nestfolio/ui-components', '@nestfolio/auth', '@nestfolio/i18n', '@nestfolio/shared-state', '@nestfolio/appsync-client']

// After
sharedMappings: ['@nestfolio/ui', '@nestfolio/shell']
```

Note: Native Federation resolves shared mappings through tsconfig paths. The wildcard `@nestfolio/shell/*` in tsconfig means subpath imports (`@nestfolio/shell/auth`, `@nestfolio/shell/graphql`, etc.) are covered by the single `@nestfolio/shell` shared mapping entry. No need to list each subpath separately.

#### jest.config.ts (5 app configs)

```ts
// Before (5 entries + testing)
moduleNameMapper: {
  '^@nestfolio/appsync-client$': '<rootDir>/../../libs/appsync-client/src/index.ts',
  '^@nestfolio/shared-state$': '<rootDir>/../../libs/shared-state/src/index.ts',
  '^@nestfolio/shared-state/testing$': '<rootDir>/../../libs/shared-state/test/testing/index.ts',
  '^@nestfolio/auth$': '<rootDir>/../../libs/auth/src/index.ts',
  '^@nestfolio/i18n$': '<rootDir>/../../libs/i18n/src/index.ts',
  '^@nestfolio/ui-components$': '<rootDir>/../../libs/ui-components/src/index.ts',
}

// After (4 entries)
moduleNameMapper: {
  '^@nestfolio/shell$': '<rootDir>/../../libs/shell/src/index.ts',
  '^@nestfolio/shell/testing$': '<rootDir>/../../libs/shell/test/testing/index.ts',
  '^@nestfolio/shell/(.+)$': '<rootDir>/../../libs/shell/src/$1/index.ts',
  '^@nestfolio/ui$': '<rootDir>/../../libs/ui/src/index.ts',
}
```

Note: `@nestfolio/shell/testing` must be listed before the wildcard `@nestfolio/shell/(.+)$` in moduleNameMapper (Jest evaluates in insertion order, stops at first match). App-specific entries (e.g., `@nestfolio/investor-events` in investor-mfe) must be preserved alongside these.

#### tsconfig.base.json

Remove:
```json
"@nestfolio/auth": ["libs/auth/src/index.ts"],
"@nestfolio/shared-state": ["libs/shared-state/src/index.ts"],
"@nestfolio/shared-state/*": ["libs/shared-state/src/*/index.ts"],
"@nestfolio/i18n": ["libs/i18n/src/index.ts"],
"@nestfolio/ui-components": ["libs/ui-components/src/index.ts"],
"@nestfolio/appsync-client": ["libs/appsync-client/src/index.ts"],
"@nestfolio/agent-core": ["libs/agent-core/src/index.ts"],
"@nestfolio/agent-core/*": ["libs/agent-core/src/*"]
```

Add:
```json
"@nestfolio/shell": ["libs/shell/src/index.ts"],
"@nestfolio/shell/testing": ["libs/shell/test/testing/index.ts"],
"@nestfolio/shell/*": ["libs/shell/src/*/index.ts"],
"@nestfolio/ui": ["libs/ui/src/index.ts"],
"@nestfolio/agent-orchestrator": ["libs/agent-orchestrator/src/index.ts"],
"@nestfolio/agent-orchestrator/*": ["libs/agent-orchestrator/src/*"]
```

---

### 4. Cleanup

After migration is verified (all tests pass):
- Delete `libs/auth/`
- Delete `libs/shared-state/`
- Delete `libs/i18n/`
- Delete `libs/appsync-client/`
- Delete `libs/ui-components/`
- Delete `libs/agent-core/`

---

## Impact Summary

| Metric | Before | After |
|---|---|---|
| Frontend libs | 5 | 2 |
| Backend libs | 4 | 4 (agent-core renamed to agent-orchestrator) |
| Total libs | 9 | 6 |
| project.json files | 9 | 6 |
| jest.config files (libs) | 9 | 6 |
| tsconfig sets (libs) | 9 × 3 = 27 | 6 × 3 = 18 |
| federation sharedMappings | 5 per file | 2 per file |
| App jest moduleNameMapper | 5-6 per file | 3-4 per file |

**Files requiring import updates:**
- ~100+ source/test files across 5 apps
- 5 federation.config.js
- 5 app jest.config.ts
- 1 tsconfig.base.json
- 7 services (agent-core → agent-orchestrator imports)

**Risk:** Low. This is a mechanical refactor — move files, update imports, update configs. No logic changes. All existing tests validate correctness.

## Non-Goals

- No changes to event-processor, cdk-constructs, or command-core (well-designed as-is)
- No changes to internal file structure of agent-orchestrator (only rename + tag fix)
- No new functionality — pure consolidation
