# Consolidate Frontend Libs & Rename agent-core

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consolidate 5 frontend libs into 2 (`@nestfolio/shell` + `@nestfolio/ui`), rename `agent-core` → `agent-orchestrator`.

**Architecture:** Move files from auth, shared-state, i18n, appsync-client into a new `shell` lib with subpath barrels. Move ui-components into a new `ui` lib (flattened). Rename agent-core directory and update all imports. Mechanical refactor — no logic changes.

**Tech Stack:** Angular, Nx, Native Federation, Jest, TypeScript path aliases

**Spec:** `docs/superpowers/specs/2026-03-21-consolidate-frontend-libs-design.md`

---

## Chunk 1: Create `@nestfolio/shell` lib (scaffold + move files)

### Task 1: Scaffold shell lib directory and config files

**Files:**
- Create: `libs/shell/project.json`
- Create: `libs/shell/tsconfig.json`
- Create: `libs/shell/tsconfig.lib.json`
- Create: `libs/shell/tsconfig.spec.json`
- Create: `libs/shell/jest.config.js`

- [ ] **Step 1: Create `libs/shell/project.json`**

```json
{
  "name": "shell",
  "$schema": "../../node_modules/nx/schemas/project-schema.json",
  "sourceRoot": "libs/shell/src",
  "projectType": "library",
  "targets": {
    "build": {
      "executor": "@nx/js:tsc",
      "outputs": ["{options.outputPath}"],
      "options": {
        "outputPath": "dist/libs/shell",
        "main": "libs/shell/src/index.ts",
        "tsConfig": "libs/shell/tsconfig.lib.json"
      }
    },
    "test": {
      "executor": "@nx/jest:jest",
      "outputs": ["{workspaceRoot}/coverage/libs/shell"],
      "options": {
        "jestConfig": "libs/shell/jest.config.js"
      }
    },
    "lint": {
      "executor": "@nx/eslint:lint"
    }
  },
  "tags": ["scope:shared", "type:lib"]
}
```

- [ ] **Step 2: Create `libs/shell/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "moduleResolution": "bundler"
  },
  "files": [],
  "include": [],
  "references": [
    { "path": "./tsconfig.lib.json" },
    { "path": "./tsconfig.spec.json" }
  ]
}
```

- [ ] **Step 3: Create `libs/shell/tsconfig.lib.json`**

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "outDir": "../../dist/out-tsc",
    "declaration": true,
    "types": ["node"]
  },
  "include": ["src/**/*.ts"],
  "exclude": ["src/**/*.test.ts", "src/**/*.spec.ts", "jest.config.ts"]
}
```

- [ ] **Step 4: Create `libs/shell/tsconfig.spec.json`**

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "outDir": "../../dist/out-tsc",
    "module": "commonjs",
    "types": ["jest", "node"]
  },
  "include": [
    "jest.config.ts",
    "src/**/*.test.ts",
    "test/**/*.test.ts",
    "src/**/*.spec.ts",
    "test/**/*.spec.ts",
    "src/**/*.ts"
  ]
}
```

- [ ] **Step 5: Create `libs/shell/jest.config.js`**

This merges the configs from all 4 absorbed libs. Key: `testEnvironment: jsdom` (graphql tests validated in Task 4). Combines all `transformIgnorePatterns` from auth, shared-state, i18n, appsync-client.

```js
const preset = require('../../jest.preset');

module.exports = {
  ...preset,
  displayName: 'shell',
  testEnvironment: 'jsdom',
  transform: {
    '^.+\\.(ts|mjs|js|html)$': [
      'jest-preset-angular',
      {
        tsconfig: '<rootDir>/tsconfig.spec.json',
        stringifyContentPathRegex: '\\.(html|svg)$',
        diagnostics: false,
      },
    ],
  },
  transformIgnorePatterns: ['node_modules/(?!.*\\.mjs$|@ngrx|@ngx-translate)'],
  moduleNameMapper: {
    '^@nestfolio/shell/testing$': '<rootDir>/test/testing/index.ts',
  },
  setupFilesAfterEnv: ['<rootDir>/test/test-setup.ts'],
};
```

- [ ] **Step 6: Create `libs/shell/test/test-setup.ts`**

```ts
import { setupZonelessTestEnv } from 'jest-preset-angular/setup-env/zoneless';

setupZonelessTestEnv();
```

---

### Task 2: Move source files into shell lib

**Files:**
- Create: `libs/shell/src/index.ts` (main barrel)
- Create: `libs/shell/src/auth/index.ts` (subpath barrel)
- Create: `libs/shell/src/graphql/index.ts` (subpath barrel)
- Create: `libs/shell/src/i18n/index.ts` (subpath barrel)
- Move: all source files from auth, shared-state, i18n, appsync-client

- [ ] **Step 1: Move shared-state source files**

```bash
mkdir -p libs/shell/src/{errors,features,stores}
cp libs/shared-state/src/errors/parse-error.ts libs/shell/src/errors/
cp libs/shared-state/src/features/with-call-state.ts libs/shell/src/features/
cp libs/shared-state/src/features/with-devtools.ts libs/shell/src/features/
cp libs/shared-state/src/features/with-logout-reset.ts libs/shell/src/features/
cp libs/shared-state/src/stores/auth.store.ts libs/shell/src/stores/
cp libs/shared-state/src/stores/notification.store.ts libs/shell/src/stores/
cp libs/shared-state/src/stores/tenant.store.ts libs/shell/src/stores/
cp libs/shared-state/src/stores/ui.store.ts libs/shell/src/stores/
cp libs/shared-state/src/global-error-handler.ts libs/shell/src/
cp libs/shared-state/src/logger.service.ts libs/shell/src/
cp libs/shared-state/src/logout-orchestrator.ts libs/shell/src/
cp libs/shared-state/src/models.ts libs/shell/src/
```

- [ ] **Step 2: Move auth source files**

```bash
mkdir -p libs/shell/src/auth
cp libs/auth/src/auth-interceptor-state.service.ts libs/shell/src/auth/
cp libs/auth/src/auth.config.ts libs/shell/src/auth/
cp libs/auth/src/auth.guard.ts libs/shell/src/auth/
cp libs/auth/src/auth.interceptor.ts libs/shell/src/auth/
cp libs/auth/src/auth.provider.ts libs/shell/src/auth/
cp libs/auth/src/auth.service.ts libs/shell/src/auth/
```

- [ ] **Step 3: Move i18n source files**

```bash
mkdir -p libs/shell/src/i18n/assets
cp libs/i18n/src/i18n.provider.ts libs/shell/src/i18n/
cp libs/i18n/src/i18n.service.ts libs/shell/src/i18n/
cp libs/i18n/src/assets/en-GB.json libs/shell/src/i18n/assets/
cp libs/i18n/src/assets/it-IT.json libs/shell/src/i18n/assets/
```

- [ ] **Step 4: Move appsync-client source files into graphql/**

```bash
mkdir -p libs/shell/src/graphql
cp libs/appsync-client/src/appsync.config.ts libs/shell/src/graphql/
cp libs/appsync-client/src/cached-query.ts libs/shell/src/graphql/
cp libs/appsync-client/src/graphql.service.ts libs/shell/src/graphql/
```

- [ ] **Step 5: Fix graphql.service.ts internal import**

In `libs/shell/src/graphql/graphql.service.ts`, the import `from '@nestfolio/shared-state'` must become a relative import (now same lib):

```ts
// Before
import { LogoutOrchestrator } from '@nestfolio/shared-state';

// After
import { LogoutOrchestrator } from '../logout-orchestrator';
```

- [ ] **Step 6: Deduplicate `Locale` type**

`Locale` is defined independently in both `libs/shell/src/models.ts` (from shared-state) and `libs/shell/src/i18n/i18n.service.ts` (from i18n). After consolidation these are in the same lib — deduplicate:

In `libs/shell/src/i18n/i18n.service.ts`, replace the local type with an import:
```ts
// Before
export type Locale = 'en-GB' | 'it-IT';

// After
import type { Locale } from '../models';
export type { Locale };
```

This keeps the canonical definition in `models.ts` and re-exports through the i18n subpath.

- [ ] **Step 7: Create main barrel `libs/shell/src/index.ts`**


This is the `@nestfolio/shell` entry point — re-exports current shared-state public API:

```ts
export type { UserProfile, TenantContext, AuthStatus, ThemeMode, Locale } from './models';
export { AuthStore } from './stores/auth.store';
export { TenantStore } from './stores/tenant.store';
export { UiStore } from './stores/ui.store';
export { NotificationStore } from './stores/notification.store';
export { LogoutOrchestrator } from './logout-orchestrator';
export { LoggerService, type LogLevel } from './logger.service';
export { GlobalErrorHandler } from './global-error-handler';
export { withCallState, setLoading, setLoaded, setError, type CallState } from './features/with-call-state';
export { withDevtools } from './features/with-devtools';
export { withLogoutReset } from './features/with-logout-reset';
export { parseError, isGraphQLErrorResponse } from './errors/parse-error';
```

- [ ] **Step 8: Create auth subpath barrel `libs/shell/src/auth/index.ts`**

```ts
export type { AuthConfig } from './auth.config';
export type { AuthTokens, AuthUser, SignUpInput } from './auth.service';
export { authSignIn, authSignUp, authConfirmSignUp, authSignOut, getAuthSession, forceRefreshSession, getAuthUser, isAuthenticated } from './auth.service';
export { authGuard } from './auth.guard';
export { authInterceptor } from './auth.interceptor';
export { AuthInterceptorState } from './auth-interceptor-state.service';
export { provideAuth } from './auth.provider';
```

- [ ] **Step 9: Create i18n subpath barrel `libs/shell/src/i18n/index.ts`**

```ts
export { I18nService, type Locale } from './i18n.service';
export { provideI18n } from './i18n.provider';
```

- [ ] **Step 10: Create graphql subpath barrel `libs/shell/src/graphql/index.ts`**

```ts
export type { AppSyncConfig } from './appsync.config';
export { APPSYNC_CONFIG } from './appsync.config';
export { GraphqlService } from './graphql.service';
export { CachedQuery } from './cached-query';
```

- [ ] **Step 11: Commit**

```bash
git add libs/shell/
git commit -m "feat: scaffold shell lib with source files from auth, shared-state, i18n, appsync-client"
```

---

### Task 3: Move test files into shell lib

**Files:**
- Move: all test files from auth, shared-state, i18n, appsync-client into `libs/shell/test/`

- [ ] **Step 1: Move shared-state test files**

```bash
mkdir -p libs/shell/test/{errors,features,stores,testing}
cp libs/shared-state/test/errors/parse-error.test.ts libs/shell/test/errors/
cp libs/shared-state/test/features/with-call-state.test.ts libs/shell/test/features/
cp libs/shared-state/test/features/with-devtools.test.ts libs/shell/test/features/
cp libs/shared-state/test/features/with-logout-reset.test.ts libs/shell/test/features/
cp libs/shared-state/test/stores/auth.store.test.ts libs/shell/test/stores/
cp libs/shared-state/test/stores/notification.store.test.ts libs/shell/test/stores/
cp libs/shared-state/test/stores/tenant.store.test.ts libs/shell/test/stores/
cp libs/shared-state/test/stores/ui.store.test.ts libs/shell/test/stores/
cp libs/shared-state/test/logger.service.spec.ts libs/shell/test/
cp libs/shared-state/test/logout-orchestrator.spec.ts libs/shell/test/
cp libs/shared-state/test/testing/index.ts libs/shell/test/testing/
cp libs/shared-state/test/testing/index.test.ts libs/shell/test/testing/
```

- [ ] **Step 2: Move auth test files**

```bash
mkdir -p libs/shell/test/auth
cp libs/auth/test/auth.guard.spec.ts libs/shell/test/auth/
cp libs/auth/test/auth.interceptor.spec.ts libs/shell/test/auth/
cp libs/auth/test/auth.service.test.ts libs/shell/test/auth/
```

- [ ] **Step 3: Move i18n test files**

```bash
mkdir -p libs/shell/test/i18n
cp libs/i18n/test/i18n.service.test.ts libs/shell/test/i18n/
```

- [ ] **Step 4: Move appsync-client test files into graphql/**

```bash
mkdir -p libs/shell/test/graphql
cp libs/appsync-client/test/appsync-config.test.ts libs/shell/test/graphql/
cp libs/appsync-client/test/cached-query.test.ts libs/shell/test/graphql/
cp libs/appsync-client/test/graphql.service.test.ts libs/shell/test/graphql/
```

- [ ] **Step 5: Fix import paths in moved test files**

The graphql test file `test/graphql/graphql.service.test.ts` has `jest.mock('@nestfolio/shared-state', ...)` — remove this mock entirely since `graphql.service.ts` now uses a relative import to `../logout-orchestrator` (fixed in Task 2 Step 5). The mock `@angular/core` at the top of the file already provides the `inject` stub that returns `mockLogoutOrchestrator`.

Other test files: check each for `@nestfolio/` imports that now point to the same lib and replace with relative imports.

- [ ] **Step 6: Add `@jest-environment node` docblock to graphql tests**

The 3 graphql test files (`test/graphql/graphql.service.test.ts`, `test/graphql/cached-query.test.ts`, `test/graphql/appsync-config.test.ts`) previously ran under `testEnvironment: node` without jest-preset-angular. `graphql.service.test.ts` heavily mocks `@angular/core` with `jest.mock()` at the top level — this conflicts with jest-preset-angular's transform under jsdom. Add this docblock at the **very first line** of each file:

```ts
/** @jest-environment node */
```

This overrides the lib-level `testEnvironment: jsdom` for these 3 files only.

- [ ] **Step 7: Commit**

```bash
git add libs/shell/test/
git commit -m "feat: move test files into shell lib"
```

---

### Task 4: Validate shell lib tests pass

- [ ] **Step 1: Update tsconfig.base.json with shell paths**

Add these entries to `tsconfig.base.json` `compilerOptions.paths` (keep old paths for now — they'll be removed in Chunk 3):

```json
"@nestfolio/shell": ["libs/shell/src/index.ts"],
"@nestfolio/shell/testing": ["libs/shell/test/testing/index.ts"],
"@nestfolio/shell/*": ["libs/shell/src/*/index.ts"]
```

Order matters: `@nestfolio/shell/testing` before `@nestfolio/shell/*`.

- [ ] **Step 2: Run shell lib tests**

```bash
pnpm nx test shell
```

Expected: ALL tests pass (same tests as before, just moved).

- [ ] **Step 3: Validate graphql tests under jsdom**

The 3 graphql test files previously ran under `testEnvironment: node`. Verify they pass under jsdom. If any fail, add `/** @jest-environment node */` docblock at the top of the failing file(s).

- [ ] **Step 4: Commit**

```bash
git add tsconfig.base.json
git commit -m "feat: add shell tsconfig paths, validate all shell tests pass"
```

---

## Chunk 2: Create `@nestfolio/ui` lib

### Task 5: Scaffold ui lib and move files

**Files:**
- Create: `libs/ui/project.json`
- Create: `libs/ui/tsconfig.json`, `tsconfig.lib.json`, `tsconfig.spec.json`
- Create: `libs/ui/jest.config.js`
- Create: `libs/ui/test/test-setup.ts`
- Create: `libs/ui/src/index.ts`
- Move: all source + test files from ui-components (flatten `src/lib/` → `src/`)

- [ ] **Step 1: Create `libs/ui/project.json`**

```json
{
  "name": "ui",
  "$schema": "../../node_modules/nx/schemas/project-schema.json",
  "sourceRoot": "libs/ui/src",
  "projectType": "library",
  "targets": {
    "build": {
      "executor": "@nx/js:tsc",
      "outputs": ["{options.outputPath}"],
      "options": {
        "outputPath": "dist/libs/ui",
        "main": "libs/ui/src/index.ts",
        "tsConfig": "libs/ui/tsconfig.lib.json"
      }
    },
    "test": {
      "executor": "@nx/jest:jest",
      "outputs": ["{workspaceRoot}/coverage/libs/ui"],
      "options": {
        "jestConfig": "libs/ui/jest.config.js"
      }
    },
    "lint": {
      "executor": "@nx/eslint:lint"
    }
  },
  "tags": ["scope:shared", "type:lib"]
}
```

- [ ] **Step 2: Create tsconfig files** (same pattern as shell)

`libs/ui/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "moduleResolution": "bundler"
  },
  "files": [],
  "include": [],
  "references": [
    { "path": "./tsconfig.lib.json" },
    { "path": "./tsconfig.spec.json" }
  ]
}
```

`libs/ui/tsconfig.lib.json`:
```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "outDir": "../../dist/out-tsc",
    "declaration": true,
    "types": ["node"]
  },
  "include": ["src/**/*.ts"],
  "exclude": ["src/**/*.test.ts", "src/**/*.spec.ts", "jest.config.ts"]
}
```

`libs/ui/tsconfig.spec.json`:
```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "outDir": "../../dist/out-tsc",
    "module": "commonjs",
    "types": ["jest", "node"]
  },
  "include": [
    "jest.config.ts",
    "src/**/*.test.ts",
    "test/**/*.test.ts",
    "src/**/*.spec.ts",
    "test/**/*.spec.ts",
    "src/**/*.ts"
  ]
}
```

- [ ] **Step 3: Create `libs/ui/jest.config.js`**

```js
const preset = require('../../jest.preset');

module.exports = {
  ...preset,
  displayName: 'ui',
  testEnvironment: 'jsdom',
  setupFilesAfterEnv: ['<rootDir>/test/test-setup.ts'],
  transform: {
    '^.+\\.(ts|mjs|js|html)$': [
      'jest-preset-angular',
      {
        tsconfig: '<rootDir>/tsconfig.spec.json',
        stringifyContentPathRegex: '\\.(html|svg)$',
        diagnostics: false,
      },
    ],
  },
  transformIgnorePatterns: ['node_modules/(?!.*\\.mjs$|primeng|@primeng)'],
};
```

- [ ] **Step 4: Create `libs/ui/test/test-setup.ts`**

```ts
import { setupZonelessTestEnv } from 'jest-preset-angular/setup-env/zoneless';

setupZonelessTestEnv();
```

- [ ] **Step 5: Move source files (flatten `src/lib/` → `src/`)**

```bash
mkdir -p libs/ui/src/{layout,shared,theme}
cp -r libs/ui-components/src/lib/layout/ libs/ui/src/layout/
cp -r libs/ui-components/src/lib/shared/ libs/ui/src/shared/
cp -r libs/ui-components/src/lib/theme/ libs/ui/src/theme/
```

- [ ] **Step 6: Create `libs/ui/src/index.ts`**

Update paths from `./lib/...` to `./...` (flattened):

```ts
// Theme
export { NestfolioPreset } from './theme/nestfolio-preset';
export { provideNestfolioTheme } from './theme/provide-theme';
export type { UiTheme } from './theme/provide-theme';

// Layout
export { ShellLayoutComponent } from './layout/shell-layout.component';
export { HeaderComponent } from './layout/header.component';
export { SidebarComponent } from './layout/sidebar.component';
export { BottomNavComponent } from './layout/bottom-nav.component';
export type { NavItem } from './layout/bottom-nav.component';

// Shared - Pipes
export { CurrencyFormatPipe } from './shared/pipes/currency-format.pipe';
export { PercentFormatPipe } from './shared/pipes/percent-format.pipe';
export { RelativeTimePipe } from './shared/pipes/relative-time.pipe';

// Shared - Components
export { StatusBadgeComponent } from './shared/badge/status-badge.component';
export type { BadgeSeverity } from './shared/badge/status-badge.component';
export { EmptyStateComponent } from './shared/empty-state/empty-state.component';
export { LoadingSkeletonComponent } from './shared/loading-skeleton/loading-skeleton.component';
export { ExpandableComponent } from './shared/expandable/expandable.component';
export { AgentBadgeComponent } from './shared/agent-badge/agent-badge.component';
```

- [ ] **Step 7: Move test files (flatten `test/lib/` → `test/`)**

```bash
mkdir -p libs/ui/test/{layout,shared}
cp -r libs/ui-components/test/lib/layout/ libs/ui/test/layout/
cp -r libs/ui-components/test/lib/shared/ libs/ui/test/shared/
```

- [ ] **Step 8: Fix internal import paths in moved test files**

The old test files use relative imports with `src/lib/` that must change because: (a) `lib/` nesting is removed, and (b) `test/lib/` nesting is also removed, changing relative depth.

Exact transformations for **layout tests** (old `test/lib/layout/` → new `test/layout/`):
```ts
// sidebar.component.spec.ts, header.component.spec.ts
// Before: from '../../../src/lib/layout/...'
// After:  from '../../src/layout/...'

// sidebar.component.spec.ts also imports NavItem:
// Before: from '../../../src/lib/layout/bottom-nav.component'
// After:  from '../../src/layout/bottom-nav.component'

// bottom-nav.component.spec.ts:
// Before: from '../../../src/lib/layout/bottom-nav.component'
// After:  from '../../src/layout/bottom-nav.component'
```

Exact transformations for **shared tests** (old `test/lib/shared/X/` → new `test/shared/X/`):
```ts
// All shared component specs (status-badge, loading-skeleton, agent-badge, empty-state, expandable):
// Before: from '../../../../src/lib/shared/X/component'
// After:  from '../../../src/shared/X/component'

// All pipe specs (currency-format, percent-format, relative-time):
// Before: from '../../../../src/lib/shared/pipes/pipe-name.pipe'
// After:  from '../../../src/shared/pipes/pipe-name.pipe'
```

In all cases: drop one `../` (because `test/lib/` → `test/`) and drop `lib/` from the `src/lib/` path.

- [ ] **Step 9: Add ui tsconfig path to `tsconfig.base.json`**

Add to `compilerOptions.paths`:
```json
"@nestfolio/ui": ["libs/ui/src/index.ts"]
```

- [ ] **Step 10: Run ui lib tests**

```bash
pnpm nx test ui
```

Expected: ALL tests pass.

- [ ] **Step 11: Commit**

```bash
git add libs/ui/ tsconfig.base.json
git commit -m "feat: scaffold ui lib with files from ui-components (flattened)"
```

---

## Chunk 3: Rewire imports across all apps

### Task 6: Update nestfolio-host imports

**Files:**
- Modify: `apps/nestfolio-host/federation.config.js`
- Modify: `apps/nestfolio-host/jest.config.ts`
- Modify: all source files in `apps/nestfolio-host/src/` that import from old lib names
- Modify: all test files in `apps/nestfolio-host/test/` that import from old lib names

- [ ] **Step 1: Update `apps/nestfolio-host/federation.config.js`**

Replace:
```js
sharedMappings: ['@nestfolio/ui-components', '@nestfolio/auth', '@nestfolio/i18n', '@nestfolio/shared-state', '@nestfolio/appsync-client'],
```
With:
```js
sharedMappings: ['@nestfolio/ui', '@nestfolio/shell'],
```

- [ ] **Step 2: Update `apps/nestfolio-host/jest.config.ts`**

Replace ONLY the moduleNameMapper block. Preserve all other config: `snapshotSerializers`, `transform`, `transformIgnorePatterns`, `setupFilesAfterEnv`, etc.
```ts
moduleNameMapper: {
  '^@nestfolio/shell$': '<rootDir>/../../libs/shell/src/index.ts',
  '^@nestfolio/shell/testing$': '<rootDir>/../../libs/shell/test/testing/index.ts',
  '^@nestfolio/shell/(.+)$': '<rootDir>/../../libs/shell/src/$1/index.ts',
  '^@nestfolio/ui$': '<rootDir>/../../libs/ui/src/index.ts',
},
```

- [ ] **Step 3: Update source file imports**

Apply these replacements across all `.ts` files in `apps/nestfolio-host/src/`:

| Old | New |
|-----|-----|
| `from '@nestfolio/auth'` | `from '@nestfolio/shell/auth'` |
| `from '@nestfolio/shared-state'` | `from '@nestfolio/shell'` |
| `from '@nestfolio/i18n'` | `from '@nestfolio/shell/i18n'` |
| `from '@nestfolio/appsync-client'` | `from '@nestfolio/shell/graphql'` |
| `from '@nestfolio/ui-components'` | `from '@nestfolio/ui'` |

Key files:
- `src/app/app.config.ts` — uses auth, i18n, ui-components, shared-state
- `src/app/app.routes.ts` — uses auth
- `src/app/app.component.ts` — uses ui-components, shared-state
- `src/app/provide-graphql.ts` — uses appsync-client
- `src/app/auth/login.component.ts` — uses auth, i18n, shared-state
- `src/app/auth/signup.component.ts` — uses auth, i18n, shared-state
- `src/app/auth/confirm.component.ts` — uses auth, i18n, shared-state

- [ ] **Step 4: Update test file imports**

Apply same replacements in `apps/nestfolio-host/test/`. Also update `jest.mock('@nestfolio/auth', ...)` → `jest.mock('@nestfolio/shell/auth', ...)` and `jest.mock('@nestfolio/appsync-client', ...)` → `jest.mock('@nestfolio/shell/graphql', ...)`.

- [ ] **Step 5: Run nestfolio-host tests**

```bash
pnpm nx test nestfolio-host
```

Expected: ALL tests pass.

- [ ] **Step 6: Commit**

```bash
git add apps/nestfolio-host/
git commit -m "refactor: rewire nestfolio-host imports to shell/ui libs"
```

---

### Task 7: Update investor-mfe imports

**Files:**
- Modify: `apps/investor-mfe/federation.config.js`
- Modify: `apps/investor-mfe/jest.config.ts`
- Modify: all `.ts` files under `apps/investor-mfe/src/` and `apps/investor-mfe/test/`

- [ ] **Step 1: Update `apps/investor-mfe/federation.config.js`**

Replace sharedMappings array:
```js
sharedMappings: ['@nestfolio/ui', '@nestfolio/shell'],
```

- [ ] **Step 2: Update `apps/investor-mfe/jest.config.ts`**

Replace moduleNameMapper — **preserve the `@nestfolio/investor-events` entry**:

```ts
moduleNameMapper: {
  '^@nestfolio/shell$': '<rootDir>/../../libs/shell/src/index.ts',
  '^@nestfolio/shell/testing$': '<rootDir>/../../libs/shell/test/testing/index.ts',
  '^@nestfolio/shell/(.+)$': '<rootDir>/../../libs/shell/src/$1/index.ts',
  '^@nestfolio/ui$': '<rootDir>/../../libs/ui/src/index.ts',
  // NOTE: old config had '^@nestfolio/investor-events$' pointing to nonexistent libs/investor-events/ — removed (dead entry, nothing imports it)
},
```

- [ ] **Step 3: Update source + test file imports**

Same replacement rules as Task 6 Step 3. Also update `@nestfolio/shared-state/testing` → `@nestfolio/shell/testing`.

Key files:
- `src/app/services/notification.service.ts` — appsync-client
- `src/app/stores/notification.store.ts` — shared-state
- `src/app/stores/onboarding.store.ts` — shared-state
- `src/app/notifications/notification-list.component.ts` — ui-components, i18n, shared-state
- `src/app/notifications/notification-item.component.ts` — ui-components
- `test/app/services/notification.service.spec.ts` — appsync-client
- `test/app/stores/notification.store.spec.ts` — shared-state
- `test/app/notifications/notification-list.component.spec.ts` — i18n, shared-state/testing

- [ ] **Step 4: Run investor-mfe tests**

```bash
pnpm nx test investor-mfe
```

Expected: ALL tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/investor-mfe/
git commit -m "refactor: rewire investor-mfe imports to shell/ui libs"
```

---

### Task 8: Update dashboard-mfe imports

**Files:**
- Modify: `apps/dashboard-mfe/federation.config.js`
- Modify: `apps/dashboard-mfe/jest.config.ts`
- Modify: all `.ts` files under `apps/dashboard-mfe/src/` and `apps/dashboard-mfe/test/`

- [ ] **Step 1: Update federation.config.js + jest.config.ts**

Same pattern as Tasks 6-7. No app-specific moduleNameMapper entries for dashboard-mfe.

```ts
// jest.config.ts moduleNameMapper
moduleNameMapper: {
  '^@nestfolio/shell$': '<rootDir>/../../libs/shell/src/index.ts',
  '^@nestfolio/shell/testing$': '<rootDir>/../../libs/shell/test/testing/index.ts',
  '^@nestfolio/shell/(.+)$': '<rootDir>/../../libs/shell/src/$1/index.ts',
  '^@nestfolio/ui$': '<rootDir>/../../libs/ui/src/index.ts',
},
```

- [ ] **Step 2: Update source + test file imports**

Same replacement rules. Key files:
- `src/app/services/dashboard.service.ts` — appsync-client, shared-state
- `src/app/stores/dashboard.store.ts` — shared-state
- `src/app/dashboard/dashboard-container.component.ts` — i18n, shared-state, ui-components
- `src/app/dashboard/kpi-cards.component.ts` — i18n, ui-components
- `src/app/dashboard/positions-table.component.ts` — i18n, ui-components
- `src/app/dashboard/allocation-chart.component.ts` — i18n
- `src/app/dashboard/advisory-alert-bar.component.ts` — i18n
- `src/app/dashboard/activity-feed.component.ts` — i18n, ui-components
- `src/app/dashboard/comparison-card.component.ts` — i18n, ui-components
- All corresponding test files with `shared-state/testing` imports

- [ ] **Step 3: Run dashboard-mfe tests**

```bash
pnpm nx test dashboard-mfe
```

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard-mfe/
git commit -m "refactor: rewire dashboard-mfe imports to shell/ui libs"
```

---

### Task 9: Update advisory-mfe imports

**Files:**
- Modify: `apps/advisory-mfe/federation.config.js`
- Modify: `apps/advisory-mfe/jest.config.ts`
- Modify: all `.ts` files under `apps/advisory-mfe/src/` and `apps/advisory-mfe/test/`

- [ ] **Step 1: Update federation.config.js + jest.config.ts**

Same pattern as Tasks 6-8.

- [ ] **Step 2: Update source + test file imports**

Key files:
- `src/app/services/advisory.service.ts` — appsync-client, shared-state
- `src/app/stores/advisory.store.ts` — shared-state
- `src/app/advisory-placeholder.component.ts` — i18n, ui-components
- `src/app/decision/decision-detail.component.ts` — ui-components, i18n, shared-state
- All corresponding test files

- [ ] **Step 3: Run advisory-mfe tests**

```bash
pnpm nx test advisory-mfe
```

- [ ] **Step 4: Commit**

```bash
git add apps/advisory-mfe/
git commit -m "refactor: rewire advisory-mfe imports to shell/ui libs"
```

---

### Task 10: Update ledger-mfe imports

**Files:**
- Modify: `apps/ledger-mfe/federation.config.js`
- Modify: `apps/ledger-mfe/jest.config.ts`
- Modify: all `.ts` files under `apps/ledger-mfe/src/` and `apps/ledger-mfe/test/`

- [ ] **Step 1: Update federation.config.js + jest.config.ts**

Same pattern as Tasks 6-8.

- [ ] **Step 2: Update source + test file imports**

Key files:
- `src/app/services/time-travel.service.ts` — appsync-client
- `src/app/services/comparison.service.ts` — appsync-client
- `src/app/stores/time-travel.store.ts` — shared-state
- `src/app/time-travel/time-travel-container.component.ts` — i18n, shared-state, ui-components
- `src/app/time-travel/time-travel-portfolio.component.ts` — i18n
- `src/app/comparison/comparison-container.component.ts` — i18n, shared-state, ui-components
- `src/app/comparison/comparison-detail.component.ts` — i18n, ui-components
- `src/app/comparison/comparison-divergence-table.component.ts` — i18n, ui-components
- All corresponding test files with `shared-state/testing` imports

- [ ] **Step 3: Run ledger-mfe tests**

```bash
pnpm nx test ledger-mfe
```

- [ ] **Step 4: Commit**

```bash
git add apps/ledger-mfe/
git commit -m "refactor: rewire ledger-mfe imports to shell/ui libs"
```

---

## Chunk 4: Rename agent-core → agent-orchestrator

### Task 11: Rename agent-core lib

**Files:**
- Rename: `libs/agent-core/` → `libs/agent-orchestrator/`
- Modify: `libs/agent-orchestrator/project.json`
- Modify: `libs/agent-orchestrator/jest.config.js` (displayName)
- Modify: `tsconfig.base.json` (path aliases)

- [ ] **Step 1: Copy agent-core to agent-orchestrator**

```bash
cp -r libs/agent-core libs/agent-orchestrator
```

- [ ] **Step 2: Update `libs/agent-orchestrator/project.json`**

Change `name`, `sourceRoot`, all path references from `agent-core` → `agent-orchestrator`. Fix tag `scope:domain` → `scope:platform`:

```json
{
  "name": "agent-orchestrator",
  "$schema": "../../node_modules/nx/schemas/project-schema.json",
  "sourceRoot": "libs/agent-orchestrator/src",
  "projectType": "library",
  "targets": {
    "build": {
      "executor": "@nx/js:tsc",
      "outputs": ["{options.outputPath}"],
      "options": {
        "outputPath": "dist/libs/agent-orchestrator",
        "main": "libs/agent-orchestrator/src/index.ts",
        "tsConfig": "libs/agent-orchestrator/tsconfig.lib.json"
      }
    },
    "test": {
      "executor": "@nx/jest:jest",
      "outputs": ["{workspaceRoot}/coverage/libs/agent-orchestrator"],
      "options": {
        "jestConfig": "libs/agent-orchestrator/jest.config.js"
      }
    },
    "lint": {
      "executor": "@nx/eslint:lint"
    }
  },
  "tags": ["scope:platform", "type:lib"]
}
```

- [ ] **Step 3: Update jest.config.js displayName**

In `libs/agent-orchestrator/jest.config.js`, change `displayName: 'agent-core'` → `displayName: 'agent-orchestrator'`.

- [ ] **Step 4: Update tsconfig.base.json**

Replace:
```json
"@nestfolio/agent-core": ["libs/agent-core/src/index.ts"],
"@nestfolio/agent-core/*": ["libs/agent-core/src/*"],
```
With:
```json
"@nestfolio/agent-orchestrator": ["libs/agent-orchestrator/src/index.ts"],
"@nestfolio/agent-orchestrator/*": ["libs/agent-orchestrator/src/*"],
```

- [ ] **Step 5: Run agent-orchestrator tests**

```bash
pnpm nx test agent-orchestrator
```

- [ ] **Step 6: Commit**

```bash
git add libs/agent-orchestrator/ tsconfig.base.json
git commit -m "refactor: rename agent-core to agent-orchestrator, fix scope tag"
```

---

### Task 12: Update agent-orchestrator consumer imports

**Files:**
- Modify: all source + test files across 7 services that import `@nestfolio/agent-core`
- Modify: all `jest.config.js` files in those services that have `moduleNameMapper` for agent-core

- [ ] **Step 1: Find all files to update**

```bash
grep -r "@nestfolio/agent-core" services/ --include="*.ts" -l
grep -r "agent-core" services/ --include="*.js" -l
```

Expected: ~35 files across advisory-ctrl, advisory-narrative-ctrl, decision-workflow-ctrl, investor-profile-ctrl, market-intelligence-ctrl, portfolio-engine-ctrl, onboarding-agent-bff.

- [ ] **Step 2: Replace imports in source files**

In all `.ts` files: `@nestfolio/agent-core` → `@nestfolio/agent-orchestrator`

- [ ] **Step 3: Replace moduleNameMapper in jest configs**

In each service's `jest.config.js` that has an `agent-core` mapper entry, update:
```js
'^@nestfolio/agent-core$': '...' → '^@nestfolio/agent-orchestrator$': '...'
```

Also update the path value from `agent-core` → `agent-orchestrator`.

- [ ] **Step 4: Run all affected service tests**

```bash
pnpm nx run-many -t test -p advisory-ctrl advisory-narrative-ctrl decision-workflow-ctrl investor-profile-ctrl market-intelligence-ctrl portfolio-engine-ctrl onboarding-agent-bff
```

Expected: ALL tests pass.

- [ ] **Step 5: Commit**

```bash
git add services/
git commit -m "refactor: update all service imports from agent-core to agent-orchestrator"
```

---

## Chunk 5: Validate + cleanup

### Task 13: Full workspace validation (before deleting old libs)

Run full validation while old libs still exist — if anything fails, the old code is still available for diagnosis.

- [ ] **Step 1: Remove old path aliases from tsconfig.base.json**

Remove these exact entries from `compilerOptions.paths`:
```json
"@nestfolio/auth": ["libs/auth/src/index.ts"],
"@nestfolio/shared-state": ["libs/shared-state/src/index.ts"],
"@nestfolio/shared-state/testing": ["libs/shared-state/test/testing/index.ts"],
"@nestfolio/i18n": ["libs/i18n/src/index.ts"],
"@nestfolio/ui-components": ["libs/ui-components/src/index.ts"],
"@nestfolio/appsync-client": ["libs/appsync-client/src/index.ts"]
```

Note: there is NO `@nestfolio/shared-state/*` wildcard entry — only the explicit `/testing` subpath.

(`@nestfolio/agent-core` paths were already replaced in Task 11.)

- [ ] **Step 2: Run all tests across the workspace**

```bash
pnpm nx run-many -t test
```

Expected: ALL projects pass. Zero test failures. The old lib directories still exist but nothing references them (tsconfig paths removed).

- [ ] **Step 3: Run lint**

```bash
pnpm nx run-many -t lint -p shell ui agent-orchestrator nestfolio-host investor-mfe dashboard-mfe advisory-mfe ledger-mfe
```

Expected: No lint errors.

- [ ] **Step 4: Verify no stale references remain**

```bash
grep -r "@nestfolio/auth" --include="*.ts" --include="*.js" --include="*.json" apps/ libs/shell/ libs/ui/ services/ | grep -v node_modules
grep -r "@nestfolio/shared-state" --include="*.ts" --include="*.js" --include="*.json" apps/ libs/shell/ libs/ui/ services/ | grep -v node_modules
grep -r "@nestfolio/i18n" --include="*.ts" --include="*.js" --include="*.json" apps/ libs/shell/ libs/ui/ services/ | grep -v node_modules
grep -r "@nestfolio/appsync-client" --include="*.ts" --include="*.js" --include="*.json" apps/ libs/shell/ libs/ui/ services/ | grep -v node_modules
grep -r "@nestfolio/ui-components" --include="*.ts" --include="*.js" --include="*.json" apps/ libs/shell/ libs/ui/ services/ | grep -v node_modules
grep -r "@nestfolio/agent-core" --include="*.ts" --include="*.js" --include="*.json" apps/ libs/shell/ libs/ui/ services/ | grep -v node_modules
```

Expected: Zero matches for all 6 patterns. Note: grep targets `libs/shell/` and `libs/ui/` (not all of `libs/`) to avoid matching old lib files that still exist.

- [ ] **Step 5: Commit tsconfig changes**

```bash
git add tsconfig.base.json
git commit -m "chore: remove stale tsconfig path aliases for old libs"
```

---

### Task 14: Delete old lib directories

Only run this after Task 13 passes — all tests green, no stale references.

- [ ] **Step 1: Delete old library directories**

```bash
rm -rf libs/auth libs/shared-state libs/i18n libs/appsync-client libs/ui-components libs/agent-core
```

- [ ] **Step 2: Verify workspace still builds**

```bash
pnpm nx run-many -t test -p shell ui agent-orchestrator
```

Expected: ALL pass (confirms no accidental dependency on old lib files).

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "chore: delete old lib directories (auth, shared-state, i18n, appsync-client, ui-components, agent-core)"
```
