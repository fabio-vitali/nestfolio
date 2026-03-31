# C4 Frontend Representation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Represent the Angular PWA / Native Federation frontend in C4 diagrams at C1 (Web App box) and C2 (individual MFE boxes with GraphQL edges to BFFs).

**Architecture:** Add a `discoverMfes()` function to `generate-c4-sources.mjs` that parses the host app's route file to auto-discover MFEs and their BFF/domain mappings. Modify `generateC1()` to render a single Web App box inside the system boundary. Modify `generateC2()` to render MFE boxes per domain and suppress CDK-discovered frontend services.

**Tech Stack:** Node.js ESM, D2 diagramming language, node:test + node:assert for tests

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `tools/generate-c4-sources.mjs` | Modify | Add `discoverMfes()`, modify `generateC1()`, `generateC2()`, and `main()` |
| `test/tools/generate-c4-sources.test.mjs` | Modify | Add tests for MFE discovery, C1 web-app node, C2 MFE nodes |

---

### Task 1: Add `discoverMfes()` — Failing Tests

**Files:**
- Test: `test/tools/generate-c4-sources.test.mjs`

- [ ] **Step 1: Write failing tests for `discoverMfes()`**

Add to the test file, after the existing `discoverServices` describe block:

```js
import {
  discoverServices,
  parseStack,
  discoverMfes,
} from '../../tools/generate-c4-sources.mjs';

describe('discoverMfes', () => {
  it('discovers 5 MFEs from host routes', () => {
    const services = discoverServices();
    const mfes = discoverMfes(services);
    assert.equal(mfes.length, 5);
    const names = mfes.map(m => m.mfe);
    assert.ok(names.includes('investor-mfe'));
    assert.ok(names.includes('dashboard-mfe'));
    assert.ok(names.includes('onboarding-mfe'));
    assert.ok(names.includes('advisory-mfe'));
    assert.ok(names.includes('ledger-mfe'));
  });

  it('maps each MFE to its BFF', () => {
    const services = discoverServices();
    const mfes = discoverMfes(services);
    const byName = Object.fromEntries(mfes.map(m => [m.mfe, m]));
    assert.equal(byName['investor-mfe'].bff, 'investor-bff');
    assert.equal(byName['dashboard-mfe'].bff, 'dashboard-bff');
    assert.equal(byName['onboarding-mfe'].bff, 'onboarding-bff');
    assert.equal(byName['advisory-mfe'].bff, 'advisory-bff');
    assert.equal(byName['ledger-mfe'].bff, 'ledger-bff');
  });

  it('resolves domain from BFF service location', () => {
    const services = discoverServices();
    const mfes = discoverMfes(services);
    const byName = Object.fromEntries(mfes.map(m => [m.mfe, m]));
    assert.equal(byName['investor-mfe'].domain, 'investor');
    assert.equal(byName['dashboard-mfe'].domain, 'investor');
    assert.equal(byName['onboarding-mfe'].domain, 'investor');
    assert.equal(byName['advisory-mfe'].domain, 'advisory');
    assert.equal(byName['ledger-mfe'].domain, 'ledger');
  });

  it('extracts route paths', () => {
    const services = discoverServices();
    const mfes = discoverMfes(services);
    const byName = Object.fromEntries(mfes.map(m => [m.mfe, m]));
    assert.equal(byName['investor-mfe'].route, '/investor');
    assert.equal(byName['onboarding-mfe'].route, '/onboarding');
    assert.equal(byName['advisory-mfe'].route, '/advisory');
  });

  it('handles MFE without provideGraphqlFor (onboarding)', () => {
    const services = discoverServices();
    const mfes = discoverMfes(services);
    const onboarding = mfes.find(m => m.mfe === 'onboarding-mfe');
    assert.equal(onboarding.bff, 'onboarding-bff');
    assert.equal(onboarding.domain, 'investor');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm nx test tools --testPathPattern generate-c4-sources -- --test-name-pattern "discoverMfes"`
Expected: FAIL — `discoverMfes` is not exported

- [ ] **Step 3: Commit**

```bash
git add test/tools/generate-c4-sources.test.mjs
git commit -m "test: add failing tests for discoverMfes()"
```

---

### Task 2: Implement `discoverMfes()`

**Files:**
- Modify: `tools/generate-c4-sources.mjs:1-9` (constants) and insert new function after `discoverServices()`

- [ ] **Step 1: Add APPS_DIR constant**

At `tools/generate-c4-sources.mjs:6` (after `SERVICES_DIR`), add:

```js
const APPS_DIR = join(ROOT, 'apps');
const HOST_APP = 'nestfolio-host';
```

- [ ] **Step 2: Add `discoverMfes()` function**

Insert after `discoverServices()` (after line 32):

```js
/**
 * Discover micro-frontend apps from the host app's routes file.
 * Parses loadMfe() calls and provideGraphqlFor() bindings.
 * @param {Array<{domain, service}>} services - Output of discoverServices()
 * @returns {Array<{mfe, bff, domain, route}>}
 */
export function discoverMfes(services) {
  const routesPath = join(APPS_DIR, HOST_APP, 'src', 'app', 'app.routes.ts');
  if (!existsSync(routesPath)) return [];
  const routesSrc = readFileSync(routesPath, 'utf-8');

  const serviceDomainMap = new Map();
  for (const svc of services) serviceDomainMap.set(svc.service, svc.domain);

  const mfes = [];
  for (const m of routesSrc.matchAll(/loadMfe\s*\(\s*'([^']+)'/g)) {
    const mfeName = m[1];
    const before = routesSrc.slice(Math.max(0, m.index - 300), m.index);

    // Path: last occurrence in lookback window
    const pathMatches = [...before.matchAll(/path\s*:\s*'([^']+)'/g)];
    const route = pathMatches.length ? `/${pathMatches.at(-1)[1]}` : '';

    // BFF: last provideGraphqlFor in lookback window, or fallback to name prefix
    const bffMatches = [...before.matchAll(/provideGraphqlFor\s*\(\s*'([^']+)'/g)];
    const bff = bffMatches.length
      ? bffMatches.at(-1)[1].replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase()
      : `${mfeName.replace(/-mfe$/, '')}-bff`;

    const domain = serviceDomainMap.get(bff) || '';
    mfes.push({ mfe: mfeName, bff, domain, route });
  }
  return mfes;
}
```

- [ ] **Step 3: Run tests to verify they pass**

Run: `pnpm nx test tools --testPathPattern generate-c4-sources -- --test-name-pattern "discoverMfes"`
Expected: All 5 tests PASS

- [ ] **Step 4: Commit**

```bash
git add tools/generate-c4-sources.mjs test/tools/generate-c4-sources.test.mjs
git commit -m "feat: add discoverMfes() — auto-discover MFEs from host routes"
```

---

### Task 3: Add `mfe` to SUFFIX_EXPANSIONS — Failing Test

**Files:**
- Test: `test/tools/generate-c4-sources.test.mjs`
- Modify: `tools/generate-c4-sources.mjs:284-289`

- [ ] **Step 1: Write failing test for MFE label**

Add after the existing tests (or in a new `describe('serviceLabel')` block):

```js
import { serviceLabel } from '../../tools/generate-c4-sources.mjs';

describe('serviceLabel', () => {
  it('expands -mfe suffix to MFE', () => {
    assert.equal(serviceLabel('investor-mfe'), 'Investor MFE');
    assert.equal(serviceLabel('dashboard-mfe'), 'Dashboard MFE');
    assert.equal(serviceLabel('onboarding-mfe'), 'Onboarding MFE');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm nx test tools --testPathPattern generate-c4-sources -- --test-name-pattern "serviceLabel"`
Expected: FAIL — returns "Investor Mfe" instead of "Investor MFE"

- [ ] **Step 3: Add `mfe` to SUFFIX_EXPANSIONS**

At `tools/generate-c4-sources.mjs:284-289`, change:

```js
const SUFFIX_EXPANSIONS = {
  ctrl: 'Controller',
  bff: 'BFF',
  hub: 'Hub',
  adpt: 'Adapter',
};
```

to:

```js
const SUFFIX_EXPANSIONS = {
  ctrl: 'Controller',
  bff: 'BFF',
  hub: 'Hub',
  adpt: 'Adapter',
  mfe: 'MFE',
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm nx test tools --testPathPattern generate-c4-sources -- --test-name-pattern "serviceLabel"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tools/generate-c4-sources.mjs test/tools/generate-c4-sources.test.mjs
git commit -m "feat: add MFE suffix expansion to serviceLabel()"
```

---

### Task 4: Modify `generateC1()` — Failing Tests

**Files:**
- Test: `test/tools/generate-c4-sources.test.mjs`

- [ ] **Step 1: Write failing tests for C1 web-app node**

```js
import { generateC1 } from '../../tools/generate-c4-sources.mjs';

describe('generateC1 with mfes', () => {
  const baseDomains = ['advisory', 'execution', 'investor', 'ledger'];
  const mfes = [
    { mfe: 'investor-mfe', bff: 'investor-bff', domain: 'investor', route: '/investor' },
    { mfe: 'dashboard-mfe', bff: 'dashboard-bff', domain: 'investor', route: '/dashboard' },
    { mfe: 'onboarding-mfe', bff: 'onboarding-bff', domain: 'investor', route: '/onboarding' },
    { mfe: 'advisory-mfe', bff: 'advisory-bff', domain: 'advisory', route: '/advisory' },
    { mfe: 'ledger-mfe', bff: 'ledger-bff', domain: 'ledger', route: '/ledger' },
  ];
  const systemMeta = { name: 'Nestfolio', description: '' };

  it('includes web-app node inside system boundary', () => {
    const d2 = generateC1({ domains: baseDomains, mfes, systemMeta });
    assert.ok(d2.includes('web-app:'));
    assert.ok(d2.includes('Nestfolio Web App'));
    assert.ok(d2.includes('class: frontend'));
  });

  it('adds user → web-app edge', () => {
    const d2 = generateC1({ domains: baseDomains, mfes, systemMeta });
    assert.ok(d2.includes('investor-user -> nestfolio.web-app'));
  });

  it('adds web-app → domain edges for domains with MFEs', () => {
    const d2 = generateC1({ domains: baseDomains, mfes, systemMeta });
    assert.ok(d2.includes('nestfolio.web-app -> nestfolio.investor-domain'));
    assert.ok(d2.includes('nestfolio.web-app -> nestfolio.advisory-domain'));
    assert.ok(d2.includes('nestfolio.web-app -> nestfolio.ledger-domain'));
  });

  it('does NOT add web-app → execution-domain edge', () => {
    const d2 = generateC1({ domains: baseDomains, mfes, systemMeta });
    assert.ok(!d2.includes('nestfolio.web-app -> nestfolio.execution-domain'));
  });

  it('does NOT include old direct user ↔ domain edge', () => {
    const d2 = generateC1({ domains: baseDomains, mfes, systemMeta });
    assert.ok(!d2.includes('<-> investor-user'));
    assert.ok(!d2.includes('investor-user {class: person}\nnestfolio.investor-domain <->'));
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm nx test tools --testPathPattern generate-c4-sources -- --test-name-pattern "generateC1 with mfes"`
Expected: FAIL — `web-app` not found in output

- [ ] **Step 3: Commit**

```bash
git add test/tools/generate-c4-sources.test.mjs
git commit -m "test: add failing tests for C1 web-app node"
```

---

### Task 5: Implement `generateC1()` Changes

**Files:**
- Modify: `tools/generate-c4-sources.mjs:907-966` (`generateC1` function)

- [ ] **Step 1: Add `mfes` to parameter destructuring**

At line 907, change:

```js
export function generateC1({
  domains,
  domainDescriptions,
  crossDomainFlows,
  frontends,
  systemMeta,
}) {
```

to:

```js
export function generateC1({
  domains,
  domainDescriptions,
  crossDomainFlows,
  frontends,
  systemMeta,
  mfes,
}) {
```

- [ ] **Step 2: Add web-app node inside system boundary**

After line 919 (`lines.push('');` inside the system boundary), insert:

```js
  // Web App node (when MFEs are discovered)
  if (mfes?.length) {
    lines.push('  web-app: "Nestfolio Web App\\n[Angular PWA / Native Federation]" {');
    lines.push('    class: frontend');
    lines.push('  }');
    lines.push('');
  }
```

- [ ] **Step 3: Replace actor section with web-app edges**

Replace lines 953-963 (the actor section after `lines.push('}');`):

```js
  // Actor for each domain that has a frontend
  const sys = sysName.toLowerCase();
  if (frontends?.length) {
    const domainsWithFrontend = [...new Set(frontends.map((fe) => fe.domain))];
    for (const d of domainsWithFrontend) {
      const title = d.charAt(0).toUpperCase() + d.slice(1);
      lines.push('');
      lines.push(`${d}-user: "${title} User" {class: person}`);
      lines.push(`${sys}.${d}-domain <-> ${d}-user {style.stroke-width: 3}`);
    }
  }
```

with:

```js
  // Investor User → Web App → domains with frontends
  const sys = sysName.toLowerCase();
  if (mfes?.length) {
    const domainsWithMfe = [...new Set(mfes.map(m => m.domain))].sort();
    lines.push('');
    lines.push('investor-user: "Investor User" {class: person}');
    lines.push(`investor-user -> ${sys}.web-app {style.stroke-width: 3}`);
    for (const d of domainsWithMfe) {
      lines.push(`${sys}.web-app -> ${sys}.${d}-domain {style.stroke-width: 2; style.stroke: "#4CAF50"}`);
    }
  } else if (frontends?.length) {
    // Fallback: old per-domain actor pattern (no MFEs discovered)
    const domainsWithFrontend = [...new Set(frontends.map((fe) => fe.domain))];
    for (const d of domainsWithFrontend) {
      const title = d.charAt(0).toUpperCase() + d.slice(1);
      lines.push('');
      lines.push(`${d}-user: "${title} User" {class: person}`);
      lines.push(`${sys}.${d}-domain <-> ${d}-user {style.stroke-width: 3}`);
    }
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm nx test tools --testPathPattern generate-c4-sources -- --test-name-pattern "generateC1 with mfes"`
Expected: All 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add tools/generate-c4-sources.mjs
git commit -m "feat: add web-app node to C1 with user→app→domain edges"
```

---

### Task 6: Modify `generateC2()` — Failing Tests

**Files:**
- Test: `test/tools/generate-c4-sources.test.mjs`

- [ ] **Step 1: Write failing tests for C2 MFE nodes**

```js
import { generateC2, discoverServices, parseStack, discoverMfes } from '../../tools/generate-c4-sources.mjs';
import { readFileSync } from 'node:fs';

describe('generateC2 with mfes', () => {
  // Use real services + stacks for the investor domain
  let investorServices, parsedStacks, mfes;

  // Setup: discover real data
  before(() => {
    const allServices = discoverServices();
    mfes = discoverMfes(allServices);
    investorServices = allServices.filter(s => s.domain === 'investor');
    parsedStacks = new Map();
    for (const svc of investorServices) {
      parsedStacks.set(svc.service, parseStack(readFileSync(svc.stackPath, 'utf-8')));
    }
  });

  it('includes MFE nodes for investor domain', () => {
    const d2 = generateC2('investor', investorServices, parsedStacks, {
      mfes: mfes.filter(m => m.domain === 'investor'),
    });
    assert.ok(d2.includes('investor-mfe:'));
    assert.ok(d2.includes('Dashboard MFE'));
    assert.ok(d2.includes('Onboarding MFE'));
    assert.ok(d2.includes('class: frontend'));
  });

  it('adds GraphQL edges from MFEs to BFFs', () => {
    const d2 = generateC2('investor', investorServices, parsedStacks, {
      mfes: mfes.filter(m => m.domain === 'investor'),
    });
    assert.ok(d2.includes('investor-mfe -> investor-bff'));
    assert.ok(d2.includes('dashboard-mfe -> dashboard-bff'));
    assert.ok(d2.includes('onboarding-mfe -> onboarding-bff'));
    assert.ok(d2.includes('GraphQL'));
  });

  it('excludes investor-web from C2', () => {
    const d2 = generateC2('investor', investorServices, parsedStacks, {
      mfes: mfes.filter(m => m.domain === 'investor'),
    });
    assert.ok(!d2.includes('investor-web:'));
    assert.ok(!d2.includes('Investor Web'));
  });

  it('excludes investor-web C3 layer import', () => {
    const d2 = generateC2('investor', investorServices, parsedStacks, {
      mfes: mfes.filter(m => m.domain === 'investor'),
    });
    assert.ok(!d2.includes('c3-investor-web'));
  });

  it('includes 1 MFE for advisory domain', () => {
    const allServices = discoverServices();
    const advisoryServices = allServices.filter(s => s.domain === 'advisory');
    const advStacks = new Map();
    for (const svc of advisoryServices) {
      advStacks.set(svc.service, parseStack(readFileSync(svc.stackPath, 'utf-8')));
    }
    const d2 = generateC2('advisory', advisoryServices, advStacks, {
      mfes: mfes.filter(m => m.domain === 'advisory'),
    });
    assert.ok(d2.includes('advisory-mfe:'));
    assert.ok(d2.includes('advisory-mfe -> advisory-bff'));
  });

  it('includes 0 MFEs for execution domain', () => {
    const allServices = discoverServices();
    const execServices = allServices.filter(s => s.domain === 'execution');
    const execStacks = new Map();
    for (const svc of execServices) {
      execStacks.set(svc.service, parseStack(readFileSync(svc.stackPath, 'utf-8')));
    }
    const d2 = generateC2('execution', execServices, execStacks, {
      mfes: mfes.filter(m => m.domain === 'execution'),
    });
    assert.ok(!d2.includes('-mfe:'));
    assert.ok(!d2.includes('class: frontend'));
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm nx test tools --testPathPattern generate-c4-sources -- --test-name-pattern "generateC2 with mfes"`
Expected: FAIL — MFE nodes not present, investor-web still present

- [ ] **Step 3: Commit**

```bash
git add test/tools/generate-c4-sources.test.mjs
git commit -m "test: add failing tests for C2 MFE nodes"
```

---

### Task 7: Implement `generateC2()` Changes

**Files:**
- Modify: `tools/generate-c4-sources.mjs:1179-1305` (`generateC2` function)

- [ ] **Step 1: Add `mfes` to the opts parameter**

At line 1179, change:

```js
export function generateC2(domain, services, parsedStacks, { serviceDescriptions, inboundEventMap }) {
```

to:

```js
export function generateC2(domain, services, parsedStacks, { serviceDescriptions, inboundEventMap, mfes }) {
```

- [ ] **Step 2: Suppress CDK frontends when MFEs are present**

At line 1200 (inside the classification loop), change:

```js
    const isFrontend = parsed.raw.distributions.length > 0 || svc.service.endsWith('-web');

    if (isCrossDomain) crossDomainAdapters.push(svc);
    else if (isDataAdapter) dataAdapters.push(svc);
    else if (isFrontend) frontends.push(svc);
    else regular.push(svc);
```

to:

```js
    const isFrontend = parsed.raw.distributions.length > 0 || svc.service.endsWith('-web');

    if (isCrossDomain) crossDomainAdapters.push(svc);
    else if (isDataAdapter) dataAdapters.push(svc);
    else if (isFrontend) {
      if (!mfes?.length) frontends.push(svc); // suppress CDK frontends when MFEs are present
    }
    else regular.push(svc);
```

- [ ] **Step 3: Add MFE nodes and GraphQL edges after service boxes**

After line 1224 (`lines.push('');` after rendering all service boxes), insert:

```js
  // MFE nodes + GraphQL edges
  const domainMfes = mfes?.filter(m => m.domain === domain) || [];
  for (const mfe of domainMfes) {
    const label = serviceLabel(mfe.mfe);
    lines.push(`${I}${mfe.mfe}: "${label}\\n[Micro-Frontend]" {`);
    lines.push(`${I}  class: frontend`);
    lines.push(`${I}}`);
    lines.push(`${I}${mfe.mfe} -> ${mfe.bff}: "GraphQL" {style.stroke: "#4CAF50"; style.stroke-width: 2}`);
  }
  if (domainMfes.length) lines.push('');
```

- [ ] **Step 4: Suppress C3 layer imports for CDK frontends**

At line 1296-1301 (layer imports section), change:

```js
  lines.push('    layers: {');
  for (const svc of services) {
    const parsed = parsedStacks.get(svc.service);
    if (parsed && parsed.raw.eventBuses.length > 0) continue;
    lines.push(`      c3-${svc.service}: { ...@./c3/${svc.service}.d2 }`);
  }
  lines.push('    }');
```

to:

```js
  lines.push('    layers: {');
  for (const svc of services) {
    const parsed = parsedStacks.get(svc.service);
    if (parsed && parsed.raw.eventBuses.length > 0) continue;
    // Skip CDK frontends when MFEs replace them
    const isCdkFrontend = parsed && (parsed.raw.distributions.length > 0 || svc.service.endsWith('-web'));
    if (mfes?.length && isCdkFrontend) continue;
    lines.push(`      c3-${svc.service}: { ...@./c3/${svc.service}.d2 }`);
  }
  lines.push('    }');
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm nx test tools --testPathPattern generate-c4-sources -- --test-name-pattern "generateC2 with mfes"`
Expected: All 6 tests PASS

- [ ] **Step 6: Commit**

```bash
git add tools/generate-c4-sources.mjs
git commit -m "feat: add MFE nodes to C2 domain views, suppress CDK frontends"
```

---

### Task 8: Wire `main()` and Suppress `investor-web` C3

**Files:**
- Modify: `tools/generate-c4-sources.mjs:1307-1395` (`main()` function)

- [ ] **Step 1: Add `discoverMfes()` call to main()**

After line 1313 (the `discoverServices()` call and log), insert:

```js
  // 1b. Discover MFEs
  const mfes = discoverMfes(services);
  console.log(`  mfes: ${mfes.length} (${mfes.map(m => m.mfe).join(', ')})`);
```

- [ ] **Step 2: Skip C3 generation for CDK frontends**

At line 1326-1334 (C3 generation loop), change:

```js
  let c3Count = 0;
  for (const svc of services) {
    const parsed = parsedStacks.get(svc.service);
    if (!parsed) continue;
    const d2 = generateC3(svc.service, svc.domain, parsed);
    writeFileSync(join(C3_DIR, `${svc.service}.d2`), d2 + '\n');
    c3Count++;
  }
```

to:

```js
  // Build set of CDK frontends to suppress when MFEs are present
  const suppressedFrontends = new Set();
  if (mfes.length) {
    for (const svc of services) {
      const parsed = parsedStacks.get(svc.service);
      if (!parsed) continue;
      if (parsed.raw.distributions.length > 0 || svc.service.endsWith('-web')) {
        suppressedFrontends.add(svc.service);
      }
    }
  }

  let c3Count = 0;
  for (const svc of services) {
    if (suppressedFrontends.has(svc.service)) continue;
    const parsed = parsedStacks.get(svc.service);
    if (!parsed) continue;
    const d2 = generateC3(svc.service, svc.domain, parsed);
    writeFileSync(join(C3_DIR, `${svc.service}.d2`), d2 + '\n');
    c3Count++;
  }
```

- [ ] **Step 3: Pass `mfes` to `generateC1()`**

At line 1365 (the `generateC1` call), change:

```js
    generateC1({ domains, domainDescriptions, crossDomainFlows, frontends, systemMeta }),
```

to:

```js
    generateC1({ domains, domainDescriptions, crossDomainFlows, frontends, systemMeta, mfes }),
```

- [ ] **Step 4: Pass `mfes` to `generateC2()` via c2Opts**

At line 1374 (the `c2Opts` definition), change:

```js
  const c2Opts = { serviceDescriptions, inboundEventMap };
```

to:

```js
  const c2Opts = { serviceDescriptions, inboundEventMap, mfes };
```

- [ ] **Step 5: Run all tests**

Run: `pnpm nx test tools --testPathPattern generate-c4-sources`
Expected: All tests PASS (existing + new)

- [ ] **Step 6: Commit**

```bash
git add tools/generate-c4-sources.mjs
git commit -m "feat: wire discoverMfes into main pipeline, suppress investor-web C3"
```

---

### Task 9: Generate and Verify Diagrams

**Files:**
- Generated: `docs/architecture/nestfolio.d2`, `docs/architecture/c3/*.d2`, `docs/architecture/nestfolio/**/*.svg`

- [ ] **Step 1: Run Stage 1 — D2 source generation**

```bash
node tools/generate-c4-sources.mjs
```

Expected output should include:
```
  mfes: 5 (investor-mfe, dashboard-mfe, onboarding-mfe, advisory-mfe, ledger-mfe)
```

- [ ] **Step 2: Verify generated D2 content**

Quick checks on `docs/architecture/nestfolio.d2`:
- `web-app:` node exists in C1 section
- `investor-user -> nestfolio.web-app` edge exists
- `nestfolio.web-app -> nestfolio.investor-domain` edge exists
- `investor-mfe:` exists in C2 Investor section
- `investor-mfe -> investor-bff` edge exists
- `investor-web:` does NOT exist in C2 Investor section
- `c3-investor-web` does NOT exist in layer imports
- `c3/investor-web.d2` does NOT exist (was not regenerated)

Run: `grep -c 'investor-web' docs/architecture/nestfolio.d2`
Expected: 0

Run: `grep -c 'web-app' docs/architecture/nestfolio.d2`
Expected: ≥3 (node + edges)

Run: `grep -c 'investor-mfe' docs/architecture/nestfolio.d2`
Expected: ≥2 (node + edge)

- [ ] **Step 3: Run Stage 2 — SVG compilation**

```bash
node tools/generate-c4-diagrams.mjs
```

Expected: SVGs compiled without errors.

- [ ] **Step 4: Verify SVG output**

```bash
ls docs/architecture/nestfolio/index.svg
ls docs/architecture/nestfolio/c2-investor/index.svg
```

Both files should exist. Open `index.svg` in a browser to visually verify:
- Green "Nestfolio Web App" box is visible in C1
- "Investor User" connects to Web App
- Web App connects to Investor, Advisory, Ledger domains

Open `c2-investor/index.svg`:
- Green MFE boxes (Investor MFE, Dashboard MFE, Onboarding MFE) are visible
- GraphQL edges connect MFEs to their BFFs
- `investor-web` is NOT present

- [ ] **Step 5: Clean up stale investor-web C3**

If `docs/architecture/c3/investor-web.d2` still exists from a previous run, remove it:

```bash
rm -f docs/architecture/c3/investor-web.d2
```

- [ ] **Step 6: Run full test suite to confirm nothing is broken**

```bash
pnpm nx test tools --testPathPattern generate-c4-sources
```

Expected: All tests PASS

- [ ] **Step 7: Commit all generated artifacts**

```bash
git add tools/generate-c4-sources.mjs test/tools/generate-c4-sources.test.mjs docs/architecture/
git commit -m "feat: represent frontend architecture in C4 diagrams

Add Nestfolio Web App to C1 with user→app→domain edges.
Add MFE boxes to C2 domain views with GraphQL edges to BFFs.
Auto-discover MFEs from host routes (discoverMfes).
Suppress investor-web CDK frontend from C2 and C3."
```
