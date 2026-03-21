# CDK Constructs Grouping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorganize the flat `libs/cdk-constructs` library into 4 subdirectories with subpath imports (`core`, `observability`, `extensions`, `utils`).

**Architecture:** Move 18 source files into 4 subdirectories, each with its own barrel. Remove the root barrel. Add tsconfig subpath aliases. Rewrite all ~62 consumer imports across the workspace to use subpaths.

**Tech Stack:** CDK, TypeScript, Nx, tsconfig path aliases

**Spec:** `docs/superpowers/specs/2026-03-21-cdk-constructs-grouping-design.md`

---

### Chunk 1: Create subdirectory structure and barrels (Tasks 1-4)

### Task 1: Create `core/` subdirectory and barrel

**Files:**
- Create: `libs/cdk-constructs/src/core/index.ts`
- Move: `libs/cdk-constructs/src/service-stack.ts` → `libs/cdk-constructs/src/core/service-stack.ts`
- Move: `libs/cdk-constructs/src/state.ts` → `libs/cdk-constructs/src/core/state.ts`
- Move: `libs/cdk-constructs/src/ingress.ts` → `libs/cdk-constructs/src/core/ingress.ts`
- Move: `libs/cdk-constructs/src/egress.ts` → `libs/cdk-constructs/src/core/egress.ts`
- Move: `libs/cdk-constructs/src/facade.ts` → `libs/cdk-constructs/src/core/facade.ts`

- [ ] **Step 1: Move source files to `core/`**

```bash
mkdir -p libs/cdk-constructs/src/core
git mv libs/cdk-constructs/src/service-stack.ts libs/cdk-constructs/src/core/
git mv libs/cdk-constructs/src/state.ts libs/cdk-constructs/src/core/
git mv libs/cdk-constructs/src/ingress.ts libs/cdk-constructs/src/core/
git mv libs/cdk-constructs/src/egress.ts libs/cdk-constructs/src/core/
git mv libs/cdk-constructs/src/facade.ts libs/cdk-constructs/src/core/
```

- [ ] **Step 2: Fix internal cross-references within core files**

Check each moved file for relative imports to other files in core (e.g., `service-stack` imports from `./state`, `ingress` imports from `./service-stack`). These stay the same since all files are in the same directory. Also check for imports to files now in other groups (e.g., `facade.ts` may import from `./default-lambda-props` which is moving to `utils/`). Update those to `../utils/default-lambda-props`.

Specifically check:
- `core/ingress.ts` — may import from `./default-lambda-props` → change to `../utils/default-lambda-props`
- `core/egress.ts` — may import from `./default-lambda-props` → change to `../utils/default-lambda-props`
- `core/facade.ts` — may import from `./default-lambda-props` → change to `../utils/default-lambda-props`
- `core/service-stack.ts` — may import from `./naming-service` → change to `../utils/naming-service`

- [ ] **Step 3: Create `core/index.ts` barrel**

```ts
// @nestfolio/cdk-constructs/core — The foundational 5-construct service pattern
export { ServiceStack, ServiceStackProps } from './service-stack';
export { State, StateProps, GsiConfig } from './state';
export { Ingress, IngressProps } from './ingress';
export { Egress, EgressProps } from './egress';
export { Facade, FacadeProps, JsResolverConfig, LambdaResolverConfig, parseSchemaFields, discoverJsResolvers } from './facade';
```

- [ ] **Step 4: Commit**

```bash
git add -A libs/cdk-constructs/src/core/
git commit -m "refactor(cdk-constructs): move core constructs to core/ subdirectory"
```

---

### Task 2: Create `observability/` subdirectory and barrel

**Files:**
- Create: `libs/cdk-constructs/src/observability/index.ts`
- Move: `libs/cdk-constructs/src/monitoring.ts` → `libs/cdk-constructs/src/observability/monitoring.ts`
- Move: `libs/cdk-constructs/src/dashboard.ts` → `libs/cdk-constructs/src/observability/dashboard.ts`

- [ ] **Step 1: Move source files to `observability/`**

```bash
mkdir -p libs/cdk-constructs/src/observability
git mv libs/cdk-constructs/src/monitoring.ts libs/cdk-constructs/src/observability/
git mv libs/cdk-constructs/src/dashboard.ts libs/cdk-constructs/src/observability/
```

- [ ] **Step 2: Fix internal cross-references**

Check `monitoring.ts` and `dashboard.ts` for relative imports to files in other groups and update paths accordingly.

- [ ] **Step 3: Create `observability/index.ts` barrel**

```ts
// @nestfolio/cdk-constructs/observability — CloudWatch monitoring and dashboards
export { Monitoring, MonitoringProps } from './monitoring';
export { ServiceDashboard, ServiceDashboardProps } from './dashboard';
```

- [ ] **Step 4: Commit**

```bash
git add -A libs/cdk-constructs/src/observability/
git commit -m "refactor(cdk-constructs): move observability constructs to observability/ subdirectory"
```

---

### Task 3: Create `extensions/` subdirectory and barrel

**Files:**
- Create: `libs/cdk-constructs/src/extensions/index.ts`
- Move: `libs/cdk-constructs/src/agent-runtime.ts` → `libs/cdk-constructs/src/extensions/agent-runtime.ts`
- Move: `libs/cdk-constructs/src/knowledge-base.ts` → `libs/cdk-constructs/src/extensions/knowledge-base.ts`
- Move: `libs/cdk-constructs/src/cross-account.ts` → `libs/cdk-constructs/src/extensions/cross-account.ts`
- Move: `libs/cdk-constructs/src/cost-controls.ts` → `libs/cdk-constructs/src/extensions/cost-controls.ts`
- Move: `libs/cdk-constructs/src/adapter-schedule.ts` → `libs/cdk-constructs/src/extensions/adapter-schedule.ts`
- Move: `libs/cdk-constructs/src/runtime-config.ts` → `libs/cdk-constructs/src/extensions/runtime-config.ts`

- [ ] **Step 1: Move source files to `extensions/`**

```bash
mkdir -p libs/cdk-constructs/src/extensions
git mv libs/cdk-constructs/src/agent-runtime.ts libs/cdk-constructs/src/extensions/
git mv libs/cdk-constructs/src/knowledge-base.ts libs/cdk-constructs/src/extensions/
git mv libs/cdk-constructs/src/cross-account.ts libs/cdk-constructs/src/extensions/
git mv libs/cdk-constructs/src/cost-controls.ts libs/cdk-constructs/src/extensions/
git mv libs/cdk-constructs/src/adapter-schedule.ts libs/cdk-constructs/src/extensions/
git mv libs/cdk-constructs/src/runtime-config.ts libs/cdk-constructs/src/extensions/
```

- [ ] **Step 2: Fix internal cross-references**

Check each file for relative imports to files now in other groups. For example:
- `agent-runtime.ts` may import from `./default-lambda-props` → change to `../utils/default-lambda-props`
- `agent-runtime.ts` may import from `./naming-service` → change to `../utils/naming-service`

- [ ] **Step 3: Create `extensions/index.ts` barrel**

```ts
// @nestfolio/cdk-constructs/extensions — Specialized, optional constructs
export { AgentRuntime, AgentRuntimeProps } from './agent-runtime';
export { KnowledgeBase, KnowledgeBaseProps } from './knowledge-base';
export {
  SharedParameter, SharedParameterProps,
  CrossAccountBusPolicy, CrossAccountBusPolicyProps,
  DomainAccountMap, getDomainAccounts, getConsumerAccountIds,
  resolveBusArn, resolveSsmValue,
} from './cross-account';
export { CostControls, CostControlsProps } from './cost-controls';
export { AdapterSchedule, AdapterScheduleProps } from './adapter-schedule';
export { RuntimeConfig, RuntimeConfigProps, RuntimeConfigSsmPaths } from './runtime-config';
```

- [ ] **Step 4: Commit**

```bash
git add -A libs/cdk-constructs/src/extensions/
git commit -m "refactor(cdk-constructs): move extension constructs to extensions/ subdirectory"
```

---

### Task 4: Create `utils/` subdirectory and barrel

**Files:**
- Create: `libs/cdk-constructs/src/utils/index.ts`
- Move: `libs/cdk-constructs/src/naming-service.ts` → `libs/cdk-constructs/src/utils/naming-service.ts`
- Move: `libs/cdk-constructs/src/default-lambda-props.ts` → `libs/cdk-constructs/src/utils/default-lambda-props.ts`
- Move: `libs/cdk-constructs/src/tagging.ts` → `libs/cdk-constructs/src/utils/tagging.ts`
- Move: `libs/cdk-constructs/src/resolve-pipeline-config.ts` → `libs/cdk-constructs/src/utils/resolve-pipeline-config.ts`

- [ ] **Step 1: Move source files to `utils/`**

```bash
mkdir -p libs/cdk-constructs/src/utils
git mv libs/cdk-constructs/src/naming-service.ts libs/cdk-constructs/src/utils/
git mv libs/cdk-constructs/src/default-lambda-props.ts libs/cdk-constructs/src/utils/
git mv libs/cdk-constructs/src/tagging.ts libs/cdk-constructs/src/utils/
git mv libs/cdk-constructs/src/resolve-pipeline-config.ts libs/cdk-constructs/src/utils/
```

- [ ] **Step 2: Fix internal cross-references**

Check each file for relative imports. For example:
- `resolve-pipeline-config.ts` may import from `./naming-service` — stays `./naming-service` (same dir)

- [ ] **Step 3: Create `utils/index.ts` barrel**

```ts
// @nestfolio/cdk-constructs/utils — Utility functions
export { defaultLambdaProps, agentLambdaProps } from './default-lambda-props';
export { NamingService, NamingServiceConfig, createNamingService, getPrefix, discoverSubsystem } from './naming-service';
export { applyStandardTags, StandardTagsProps } from './tagging';
export { resolvePipelineConfig, ResolvedPipelineConfig, ScheduleConfig, inferServiceMetadata, loadTierDefaults, mergeConfigs, HARDCODED_FALLBACKS } from './resolve-pipeline-config';
```

- [ ] **Step 4: Commit**

```bash
git add -A libs/cdk-constructs/src/utils/
git commit -m "refactor(cdk-constructs): move utility functions to utils/ subdirectory"
```

---

### Chunk 2: Update tsconfig and delete root barrel (Task 5)

### Task 5: Update tsconfig.base.json and delete root barrel

**Files:**
- Modify: `tsconfig.base.json`
- Delete: `libs/cdk-constructs/src/index.ts`

- [ ] **Step 1: Update tsconfig.base.json**

Replace the single `@nestfolio/cdk-constructs` path with 4 subpath aliases. The root alias is removed.

In `tsconfig.base.json`, replace:
```json
"@nestfolio/cdk-constructs": ["libs/cdk-constructs/src/index.ts"],
```

With:
```json
"@nestfolio/cdk-constructs/core": ["libs/cdk-constructs/src/core/index.ts"],
"@nestfolio/cdk-constructs/observability": ["libs/cdk-constructs/src/observability/index.ts"],
"@nestfolio/cdk-constructs/extensions": ["libs/cdk-constructs/src/extensions/index.ts"],
"@nestfolio/cdk-constructs/utils": ["libs/cdk-constructs/src/utils/index.ts"],
```

- [ ] **Step 2: Delete root barrel**

```bash
git rm libs/cdk-constructs/src/index.ts
```

- [ ] **Step 3: Commit**

```bash
git add tsconfig.base.json
git commit -m "refactor(cdk-constructs): replace root barrel with subpath aliases"
```

---

### Chunk 3: Migrate consumer imports (Tasks 6-10)

Each task covers one consumer category. For every file, replace `from '@nestfolio/cdk-constructs'` with the appropriate subpath import(s). A single old import may split into 2-4 new imports.

### Task 6: Migrate hub stacks (investor-hub, advisory-hub, execution-hub, ledger-hub)

**Files:**
- Modify: `services/investor/investor-hub/src/service.stack.ts`
- Modify: `services/investor/investor-hub/src/main.ts`
- Modify: `services/advisory/advisory-hub/src/service.stack.ts`
- Modify: `services/advisory/advisory-hub/src/main.ts`
- Modify: `services/execution/execution-hub/src/service.stack.ts`
- Modify: `services/execution/execution-hub/src/main.ts`
- Modify: `services/ledger/ledger-hub/src/service.stack.ts`
- Modify: `services/ledger/ledger-hub/src/main.ts`

- [ ] **Step 1: Migrate investor-hub service.stack.ts**

Replace:
```ts
import {
  ServiceStack, ServiceStackProps, CostControls, Monitoring, ServiceDashboard,
  SharedParameter, CrossAccountBusPolicy, getDomainAccounts, getConsumerAccountIds,
} from '@nestfolio/cdk-constructs';
```

With:
```ts
import { ServiceStack, ServiceStackProps } from '@nestfolio/cdk-constructs/core';
import { Monitoring, ServiceDashboard } from '@nestfolio/cdk-constructs/observability';
import {
  CostControls, SharedParameter, CrossAccountBusPolicy,
  getDomainAccounts, getConsumerAccountIds,
} from '@nestfolio/cdk-constructs/extensions';
```

- [ ] **Step 2: Migrate investor-hub main.ts**

Replace:
```ts
import { resolvePipelineConfig } from '@nestfolio/cdk-constructs';
```
With:
```ts
import { resolvePipelineConfig } from '@nestfolio/cdk-constructs/utils';
```

- [ ] **Step 3: Migrate advisory-hub service.stack.ts**

Replace:
```ts
import {
  ServiceStack, ServiceStackProps, Monitoring, ServiceDashboard,
  SharedParameter, CrossAccountBusPolicy, getDomainAccounts, getConsumerAccountIds,
} from '@nestfolio/cdk-constructs';
```

With:
```ts
import { ServiceStack, ServiceStackProps } from '@nestfolio/cdk-constructs/core';
import { Monitoring, ServiceDashboard } from '@nestfolio/cdk-constructs/observability';
import {
  SharedParameter, CrossAccountBusPolicy,
  getDomainAccounts, getConsumerAccountIds,
} from '@nestfolio/cdk-constructs/extensions';
```

- [ ] **Step 4: Migrate advisory-hub main.ts**

```ts
import { resolvePipelineConfig } from '@nestfolio/cdk-constructs/utils';
```

- [ ] **Step 5: Migrate execution-hub service.stack.ts**

Same pattern as advisory-hub (ServiceStack + Monitoring/ServiceDashboard + SharedParameter/CrossAccountBusPolicy/getDomainAccounts/getConsumerAccountIds).

- [ ] **Step 6: Migrate execution-hub main.ts**

```ts
import { resolvePipelineConfig } from '@nestfolio/cdk-constructs/utils';
```

- [ ] **Step 7: Migrate ledger-hub service.stack.ts**

Same pattern as advisory-hub/execution-hub.

- [ ] **Step 8: Migrate ledger-hub main.ts**

```ts
import { resolvePipelineConfig } from '@nestfolio/cdk-constructs/utils';
```

- [ ] **Step 9: Run tests for all 4 hubs**

```bash
pnpm nx run-many -t test --projects=investor-hub,advisory-hub,execution-hub,ledger-hub
```

Expected: All pass.

- [ ] **Step 10: Commit**

```bash
git add services/investor/investor-hub services/advisory/advisory-hub services/execution/execution-hub services/ledger/ledger-hub
git commit -m "refactor: migrate hub stack imports to cdk-constructs subpaths"
```

---

### Task 7: Migrate BFF services (investor-bff, advisory-bff, dashboard-bff, ledger-bff, onboarding-agent-bff)

**Files:**
- Modify: `services/investor/investor-bff/src/service.stack.ts` + `main.ts`
- Modify: `services/advisory/advisory-bff/src/service.stack.ts` + `main.ts`
- Modify: `services/investor/dashboard-bff/src/service.stack.ts` + `main.ts`
- Modify: `services/ledger/ledger-bff/src/service.stack.ts` + `main.ts`
- Modify: `services/investor/onboarding-agent-bff/src/service.stack.ts` + `main.ts`

- [ ] **Step 1: Migrate advisory-bff service.stack.ts**

Replace:
```ts
import { ServiceStack, ServiceStackProps, Ingress, Egress, Facade, discoverJsResolvers } from '@nestfolio/cdk-constructs';
```
With:
```ts
import { ServiceStack, ServiceStackProps, Ingress, Egress, Facade, discoverJsResolvers } from '@nestfolio/cdk-constructs/core';
```

- [ ] **Step 2: Migrate dashboard-bff service.stack.ts**

Replace:
```ts
import { ServiceStack, ServiceStackProps, Ingress, Facade, discoverJsResolvers } from '@nestfolio/cdk-constructs';
```
With:
```ts
import { ServiceStack, ServiceStackProps, Ingress, Facade, discoverJsResolvers } from '@nestfolio/cdk-constructs/core';
```

- [ ] **Step 3: Migrate investor-bff service.stack.ts**

Read the file first. It imports ServiceStack, ServiceStackProps + other constructs. Split into core + utils/extensions as needed.

- [ ] **Step 4: Migrate ledger-bff service.stack.ts**

Current import:
```ts
import { ServiceStack, ServiceStackProps, Ingress, Facade, discoverJsResolvers, defaultLambdaProps, getDomainAccounts, resolveBusArn } from '@nestfolio/cdk-constructs';
```
Split into:
```ts
import { ServiceStack, ServiceStackProps, Ingress, Facade, discoverJsResolvers } from '@nestfolio/cdk-constructs/core';
import { defaultLambdaProps } from '@nestfolio/cdk-constructs/utils';
import { getDomainAccounts, resolveBusArn } from '@nestfolio/cdk-constructs/extensions';
```

- [ ] **Step 5: Migrate onboarding-agent-bff service.stack.ts**

Current import:
```ts
import {
  AgentRuntime, KnowledgeBase, ServiceStack, ServiceStackProps,
} from '@nestfolio/cdk-constructs';
```
Split into:
```ts
import { ServiceStack, ServiceStackProps } from '@nestfolio/cdk-constructs/core';
import { AgentRuntime, KnowledgeBase } from '@nestfolio/cdk-constructs/extensions';
```

- [ ] **Step 6: Migrate all 5 BFF main.ts files**

All have: `import { resolvePipelineConfig } from '@nestfolio/cdk-constructs';`
Change to: `import { resolvePipelineConfig } from '@nestfolio/cdk-constructs/utils';`

- [ ] **Step 7: Run tests for all 5 BFFs**

```bash
pnpm nx run-many -t test --projects=investor-bff,advisory-bff,dashboard-bff,ledger-bff,onboarding-agent-bff
```

Expected: All pass.

- [ ] **Step 8: Commit**

```bash
git add services/investor/investor-bff services/advisory/advisory-bff services/investor/dashboard-bff services/ledger/ledger-bff services/investor/onboarding-agent-bff
git commit -m "refactor: migrate BFF imports to cdk-constructs subpaths"
```

---

### Task 8: Migrate simple controller/adapter services (core + utils only)

These services import only `ServiceStack`, `Ingress`, `Egress`, and `resolvePipelineConfig` — the simplest pattern.

**Files (service.stack.ts + main.ts for each):**
- `services/execution/execution-ctrl/src/`
- `services/execution/execution-adpt/src/`
- `services/execution/broker-adpt/src/`
- `services/investor/investor-ctrl/src/`
- `services/advisory/compliance-ctrl/src/`

- [ ] **Step 1: Migrate all 5 service.stack.ts files**

Pattern: replace `from '@nestfolio/cdk-constructs'` with `from '@nestfolio/cdk-constructs/core'` (these only import core constructs: ServiceStack, ServiceStackProps, Ingress, Egress).

- [ ] **Step 2: Migrate all 5 main.ts files**

Pattern: `import { resolvePipelineConfig } from '@nestfolio/cdk-constructs/utils';`

- [ ] **Step 3: Run tests**

```bash
pnpm nx run-many -t test --projects=execution-ctrl,execution-adpt,broker-adpt,investor-ctrl,compliance-ctrl
```

Expected: All pass.

- [ ] **Step 4: Commit**

```bash
git add services/execution/execution-ctrl services/execution/execution-adpt services/execution/broker-adpt services/investor/investor-ctrl services/advisory/compliance-ctrl
git commit -m "refactor: migrate simple service imports to cdk-constructs subpaths"
```

---

### Task 9: Migrate services with mixed imports (core + utils + sometimes extensions/observability)

These services import constructs from multiple groups.

**Files (service.stack.ts + main.ts for each):**
- `services/advisory/advisory-ctrl/src/` — core + extensions (AgentRuntime) + utils (defaultLambdaProps, createNamingService)
- `services/advisory/decision-workflow-ctrl/src/` — core + utils (NamingService, defaultLambdaProps)
- `services/investor/investor-web/src/` — core + utils (defaultLambdaProps)
- `services/investor/investor-adpt/src/` — read file to determine import shape
- `services/ledger/ledger-ctrl/src/` — core + utils (defaultLambdaProps) + extensions (getDomainAccounts, resolveBusArn)
- `services/ledger/ledger-adpt/src/` — core + observability (Monitoring, ServiceDashboard) + extensions (getDomainAccounts, resolveBusArn)
- `services/ledger/reconciliation-ctrl/src/` — core + extensions (getDomainAccounts, resolveBusArn)
- `services/advisory/advisory-adpt/src/` — core + observability (Monitoring, ServiceDashboard) + extensions (getDomainAccounts, resolveBusArn)

- [ ] **Step 1: Migrate advisory-ctrl service.stack.ts**

Current import:
```ts
import {
  ServiceStack, ServiceStackProps, Ingress, Egress,
  AgentRuntime, defaultLambdaProps, createNamingService,
} from '@nestfolio/cdk-constructs';
```
Split into:
```ts
import { ServiceStack, ServiceStackProps, Ingress, Egress } from '@nestfolio/cdk-constructs/core';
import { AgentRuntime } from '@nestfolio/cdk-constructs/extensions';
import { defaultLambdaProps, createNamingService } from '@nestfolio/cdk-constructs/utils';
```

- [ ] **Step 2: Migrate decision-workflow-ctrl service.stack.ts**

Current import:
```ts
import { ServiceStack, ServiceStackProps, NamingService, Ingress, Egress, defaultLambdaProps } from '@nestfolio/cdk-constructs';
```
Split into:
```ts
import { ServiceStack, ServiceStackProps, Ingress, Egress } from '@nestfolio/cdk-constructs/core';
import { NamingService, defaultLambdaProps } from '@nestfolio/cdk-constructs/utils';
```

- [ ] **Step 3: Migrate ledger-ctrl service.stack.ts**

Current import:
```ts
import { ServiceStack, ServiceStackProps, Ingress, Egress, defaultLambdaProps, getDomainAccounts, resolveBusArn } from '@nestfolio/cdk-constructs';
```
Split into:
```ts
import { ServiceStack, ServiceStackProps, Ingress, Egress } from '@nestfolio/cdk-constructs/core';
import { defaultLambdaProps } from '@nestfolio/cdk-constructs/utils';
import { getDomainAccounts, resolveBusArn } from '@nestfolio/cdk-constructs/extensions';
```

- [ ] **Step 4: Migrate reconciliation-ctrl service.stack.ts**

Current import:
```ts
import { ServiceStack, ServiceStackProps, Ingress, Egress, getDomainAccounts, resolveBusArn } from '@nestfolio/cdk-constructs';
```
Split into:
```ts
import { ServiceStack, ServiceStackProps, Ingress, Egress } from '@nestfolio/cdk-constructs/core';
import { getDomainAccounts, resolveBusArn } from '@nestfolio/cdk-constructs/extensions';
```

- [ ] **Step 5: Migrate ledger-adpt service.stack.ts**

Current import:
```ts
import {
  ServiceStack, ServiceStackProps, Monitoring, ServiceDashboard,
  getDomainAccounts, resolveBusArn,
} from '@nestfolio/cdk-constructs';
```
Split into:
```ts
import { ServiceStack, ServiceStackProps } from '@nestfolio/cdk-constructs/core';
import { Monitoring, ServiceDashboard } from '@nestfolio/cdk-constructs/observability';
import { getDomainAccounts, resolveBusArn } from '@nestfolio/cdk-constructs/extensions';
```

- [ ] **Step 6: Migrate advisory-adpt service.stack.ts**

Current import:
```ts
import {
  ServiceStack, ServiceStackProps, Monitoring, ServiceDashboard,
  getDomainAccounts, resolveBusArn,
} from '@nestfolio/cdk-constructs';
```
Split into:
```ts
import { ServiceStack, ServiceStackProps } from '@nestfolio/cdk-constructs/core';
import { Monitoring, ServiceDashboard } from '@nestfolio/cdk-constructs/observability';
import { getDomainAccounts, resolveBusArn } from '@nestfolio/cdk-constructs/extensions';
```

- [ ] **Step 7: Migrate remaining service (investor-web, investor-adpt)**

Read each `service.stack.ts`, determine the import shape, and split accordingly.

- [ ] **Step 8: Migrate all 8 main.ts files**

Pattern: `import { resolvePipelineConfig } from '@nestfolio/cdk-constructs/utils';`

- [ ] **Step 9: Run tests**

```bash
pnpm nx run-many -t test --projects=advisory-ctrl,decision-workflow-ctrl,investor-web,investor-adpt,ledger-ctrl,ledger-adpt,reconciliation-ctrl,advisory-adpt
```

Expected: All pass.

- [ ] **Step 10: Commit**

```bash
git add services/advisory/advisory-ctrl services/advisory/decision-workflow-ctrl services/investor/investor-web services/investor/investor-adpt services/ledger/ledger-ctrl services/ledger/ledger-adpt services/ledger/reconciliation-ctrl services/advisory/advisory-adpt
git commit -m "refactor: migrate mixed-import services to cdk-constructs subpaths"
```

---

### Task 10: Migrate advisory data-source adapters and agent controllers

Two sub-patterns:
- **Data-source adapters** (5 adpts): core + observability (Monitoring, ServiceDashboard) + extensions (AdapterSchedule, getDomainAccounts, resolveBusArn) + utils (defaultLambdaProps)
- **Agent controllers** (4 ctrls): core + extensions (AgentRuntime, KnowledgeBase) + utils (defaultLambdaProps, NamingService)

**Files (service.stack.ts + main.ts for each):**

Data-source adapters:
- `services/advisory/alpha-vantage-adpt/src/`
- `services/advisory/fred-adpt/src/`
- `services/advisory/marketwatch-adpt/src/`
- `services/advisory/sec-edgar-adpt/src/`
- `services/advisory/yahoo-finance-adpt/src/`

Agent controllers:
- `services/advisory/market-intelligence-ctrl/src/`
- `services/advisory/advisory-narrative-ctrl/src/`
- `services/advisory/portfolio-engine-ctrl/src/`
- `services/advisory/investor-profile-ctrl/src/`

- [ ] **Step 1: Migrate data-source adapter service.stack.ts files (5 adpts)**

Example (alpha-vantage-adpt) — current import:
```ts
import {
  ServiceStack, ServiceStackProps, defaultLambdaProps,
  Monitoring, ServiceDashboard, AdapterSchedule,
  getDomainAccounts, resolveBusArn,
} from '@nestfolio/cdk-constructs';
```
Split into:
```ts
import { ServiceStack, ServiceStackProps } from '@nestfolio/cdk-constructs/core';
import { Monitoring, ServiceDashboard } from '@nestfolio/cdk-constructs/observability';
import { AdapterSchedule, getDomainAccounts, resolveBusArn } from '@nestfolio/cdk-constructs/extensions';
import { defaultLambdaProps } from '@nestfolio/cdk-constructs/utils';
```

Apply same pattern to all 5 adapters. Read each file first to confirm exact import shape.

- [ ] **Step 2: Migrate agent controller service.stack.ts files (4 ctrls)**

Example (investor-profile-ctrl) — current import:
```ts
import {
  ServiceStack, ServiceStackProps, Ingress, Egress,
  AgentRuntime, KnowledgeBase, defaultLambdaProps, NamingService,
} from '@nestfolio/cdk-constructs';
```
Split into:
```ts
import { ServiceStack, ServiceStackProps, Ingress, Egress } from '@nestfolio/cdk-constructs/core';
import { AgentRuntime, KnowledgeBase } from '@nestfolio/cdk-constructs/extensions';
import { defaultLambdaProps, NamingService } from '@nestfolio/cdk-constructs/utils';
```

Apply same pattern to all 4 controllers. Read each file first to confirm exact import shape (some may not use all of AgentRuntime/KnowledgeBase/NamingService).

- [ ] **Step 3: Migrate all 9 main.ts files**

Pattern: `import { resolvePipelineConfig } from '@nestfolio/cdk-constructs/utils';`

- [ ] **Step 4: Run tests**

```bash
pnpm nx run-many -t test --projects=alpha-vantage-adpt,fred-adpt,marketwatch-adpt,sec-edgar-adpt,yahoo-finance-adpt,market-intelligence-ctrl,advisory-narrative-ctrl,portfolio-engine-ctrl,investor-profile-ctrl
```

Expected: All pass.

- [ ] **Step 5: Commit**

```bash
git add services/advisory/alpha-vantage-adpt services/advisory/fred-adpt services/advisory/marketwatch-adpt services/advisory/sec-edgar-adpt services/advisory/yahoo-finance-adpt services/advisory/market-intelligence-ctrl services/advisory/advisory-narrative-ctrl services/advisory/portfolio-engine-ctrl services/advisory/investor-profile-ctrl
git commit -m "refactor: migrate advisory adapter and agent-controller imports to cdk-constructs subpaths"
```

---

### Chunk 4: Migrate tests (Task 11)

### Task 11: Move test files into subdirectories and fix imports

**Files:**
- Move: 13 test files from `libs/cdk-constructs/test/` to subdirectories
- Update: relative imports in each test file (`../src/X` → `../../src/group/X`)

- [ ] **Step 1: Create test subdirectories and move files**

```bash
mkdir -p libs/cdk-constructs/test/{core,observability,extensions,utils}

# core tests
git mv libs/cdk-constructs/test/service-stack.test.ts libs/cdk-constructs/test/core/
git mv libs/cdk-constructs/test/state.test.ts libs/cdk-constructs/test/core/
git mv libs/cdk-constructs/test/ingress.test.ts libs/cdk-constructs/test/core/
git mv libs/cdk-constructs/test/egress.test.ts libs/cdk-constructs/test/core/
git mv libs/cdk-constructs/test/facade.test.ts libs/cdk-constructs/test/core/

# observability tests
git mv libs/cdk-constructs/test/monitoring.test.ts libs/cdk-constructs/test/observability/

# extensions tests
git mv libs/cdk-constructs/test/adapter-schedule.test.ts libs/cdk-constructs/test/extensions/
git mv libs/cdk-constructs/test/cross-account.test.ts libs/cdk-constructs/test/extensions/
git mv libs/cdk-constructs/test/knowledge-base.test.ts libs/cdk-constructs/test/extensions/

# utils tests
git mv libs/cdk-constructs/test/default-lambda-props.test.ts libs/cdk-constructs/test/utils/
git mv libs/cdk-constructs/test/naming-service.test.ts libs/cdk-constructs/test/utils/
git mv libs/cdk-constructs/test/resolve-pipeline-config.test.ts libs/cdk-constructs/test/utils/
git mv libs/cdk-constructs/test/tagging.test.ts libs/cdk-constructs/test/utils/
```

- [ ] **Step 2: Fix relative imports in core tests**

Each test imported from `../src/X`. Now at `test/core/X.test.ts`, imports become `../../src/core/X`.

Example for `test/core/facade.test.ts`:
```ts
// Before: import { Facade, parseSchemaFields, discoverJsResolvers } from '../src/facade';
// After:  import { Facade, parseSchemaFields, discoverJsResolvers } from '../../src/core/facade';
```

Apply same pattern to all 5 core test files. Also check for cross-group imports (e.g., a core test might import from `../src/default-lambda-props` → `../../src/utils/default-lambda-props`).

- [ ] **Step 3: Fix relative imports in observability tests**

```ts
// Before: import { Monitoring } from '../src/monitoring';
// After:  import { Monitoring } from '../../src/observability/monitoring';
```

- [ ] **Step 4: Fix relative imports in extensions tests**

```ts
// Before: import { CrossAccountBusPolicy, ... } from '../src/cross-account';
// After:  import { CrossAccountBusPolicy, ... } from '../../src/extensions/cross-account';
```

Apply to all 3 extensions test files.

- [ ] **Step 5: Fix relative imports in utils tests**

```ts
// Before: import { defaultLambdaProps, agentLambdaProps } from '../src/default-lambda-props';
// After:  import { defaultLambdaProps, agentLambdaProps } from '../../src/utils/default-lambda-props';
```

Apply to all 4 utils test files.

- [ ] **Step 6: Run all cdk-constructs tests**

```bash
pnpm nx test cdk-constructs
```

Expected: All 13 test files pass.

- [ ] **Step 7: Commit**

```bash
git add libs/cdk-constructs/test/
git commit -m "refactor(cdk-constructs): move tests into subdirectories matching source structure"
```

---

### Chunk 5: Final verification (Task 12)

### Task 12: Full workspace verification and cleanup

- [ ] **Step 1: Verify no remaining old imports**

```bash
grep -r "from '@nestfolio/cdk-constructs'" --include='*.ts' services/ libs/ | grep -v node_modules | grep -v docs/
```

Expected: No matches. If any remain, fix them.

- [ ] **Step 2: Run full workspace tests**

```bash
pnpm nx run-many -t test --all
```

Expected: All projects pass.

- [ ] **Step 3: Verify no remaining files in src/ root**

```bash
ls libs/cdk-constructs/src/*.ts
```

Expected: No files (all moved to subdirectories). If `index.ts` still exists, delete it.

- [ ] **Step 4: Commit any remaining fixes**

```bash
git add -A
git commit -m "refactor(cdk-constructs): final cleanup after grouping migration"
```

Note: Skip this step if there are no remaining changes.
