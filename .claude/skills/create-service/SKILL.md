---
name: create-service
description: Scaffold a new service — Nx project, file structure, CDK stack, event subscriptions, handlers, tests, service card.
---

## When This Skill Applies
- Creating a brand new service
- Splitting an existing service

## Prerequisites
- Determine domain and service type suffix (-ctrl, -bff, -hub, -adpt)
- Read `cdk-patterns` skill

## Checklist

- [ ] 1. **Create Nx project** — services use `projectType: "application"` (not library)
  ```bash
  pnpm nx g @nx/js:library services/{domain}/{service-name} --unitTestRunner=jest --bundler=none
  ```
  Then manually update `project.json`: set `"projectType": "application"`, add `deploy`/`destroy` targets pointing to `main.ts`. Verify flags with `--help` first.

- [ ] 2. **Set up file structure:**
  ```
  services/{domain}/{service-name}/
    src/
      main.ts                      <- CDK app entry point (App + resolvePipelineConfig)
      service.stack.ts
      handlers/{first-handler}.ts
      domain/events.ts
      domain/schemas.ts
      domain/index.ts
    test/
      unit/
        service.stack.test.ts
        {first-handler}.test.ts
    project.json                   <- projectType: "application", deploy/destroy/test/lint/test-integration targets
    jest.config.js                 <- extends jest.preset, moduleNameMapper for @nestfolio/*
    jest.integration.config.js     <- integration test config (see test-integration target below)
    tsconfig.json
    tsconfig.lib.json
    tsconfig.spec.json
  ```
  **Optional directories** (add as needed): `repositories/` (DDB access), `services/` (business logic), `state-machine/` (Step Functions definitions).

- [ ] 2b. **Write `main.ts`** — CDK app entry point using `resolvePipelineConfig`:
  ```ts
  import { App } from 'aws-cdk-lib';
  import { resolvePipelineConfig } from '@nestfolio/cdk-constructs/utils';
  import { MyServiceStack } from './service.stack';

  const app = new App();
  const { prefix, account, region, service, subsystem, observability } = resolvePipelineConfig(app, 'my-service');

  new MyServiceStack(app, `${prefix}-${service}`, {
    subsystem,
    service,
    prefix,
    observability,
    env: {
      account: account ?? process.env['CDK_DEFAULT_ACCOUNT'],
      region: region ?? process.env['CDK_DEFAULT_REGION'] ?? 'us-east-1',
    },
  });

  app.synth();
  ```
  **IMPORTANT:** `observability` must be destructured from `resolvePipelineConfig()` AND passed to the stack constructor.

- [ ] 3. **Write CDK stack** — extend ServiceStack with `serviceDir: __dirname`, create State explicitly (if needed), add Ingress/Egress/Orchestration/Broadcaster per `cdk-patterns` (7-construct model)
  ```ts
  super(scope, id, { ...props, serviceDir: __dirname });
  ```
  - All services that need DynamoDB: `const state = new State(this, 'State'); this.state = state;`
  - Pass `state` to Ingress, Egress, Facade, AgentRuntime as needed
  - For orchestrated services (-ctrl with Step Functions): add `new Orchestration(this, 'MyStateMachine', { state, definitionBody, triggers })`
  - Call `this.addObservability({ ingress, egress })` at end of constructor
- [ ] 4. **Write first handler** per `event-processor-patterns`
- [ ] 4b. **Classify read-model ownership** for every DynamoDB row the service writes —
  see `docs/architecture/READ-MODEL-OWNERSHIP.md`. Per row, decide command-owned
  (local actor drives ongoing state → field-level `update` + conditions; `record`
  seed) vs projection (external authority → `projectVersioned` P1 with a monotonic
  `__version`, `record` P2, or derived P3 — never `accumulate`). Declare them in
  `src/read-model-ownership.ts` (`declare module '@nestfolio/event-processor' {
  interface ReadModelOwnership { … } }`), side-effect-import it from each handler,
  and add a `typecheck` target + `tsconfig.type-test.json` + a
  `test/types/read-model-ownership.type-test.ts` (mirror investor-bff/dashboard-bff).
  Run `pnpm nx run event-processor:read-model-drift` after wiring.
  If a row is a verified **non-governed** outbox/CDC-carrier or external-feed cache
  (written via an intent factory but never read back as a read model), do NOT register
  it — add a `{ "service", "typename", "reason" }` entry to
  `tools/read-model-exclusions.json` instead. The gate errors on any intent-factory
  write that is neither registered nor excluded.
- [ ] 5. **Define event types** per `create-event`

### Typed-subject conventions (enforced)

When a service produces an event, it owns ONE zod contract that types both the persisted
row and the emitted subject:

- Name it for the clean domain/event concept — `<Name>Schema` + `type <Name>` — **no
  `Subject` suffix** (event-aligned name on clash, e.g. `LedgerEntryRecorded`,
  `InvestorProfileUpdated`).
- Type the row as `TableEntry<Name, RequestContext>` and the event as
  `BusEvent<Name, RequestContext>` — never a hand-rolled `pk`/`sk`/`__typename` interface,
  and never drop the context generic.
- **Import channel:** intra-domain consumers import the producer's
  `@nestfolio/<svc>/contracts` (payloads) and `@nestfolio/<svc>/events` (names) directly;
  cross-domain consumers import BOTH from the producer-domain's
  `@nestfolio/<domain>-adpt/domain` re-export. Add the re-export to that adapter's `/domain`
  index (schemas) and its `*CrossDomainEventTypes` map (names). Never reach into another
  domain's `/contracts` or `/events`.
  **Mutual intra-domain exception** (A↔B cycle): boundary contracts live in the
  domain adapter `/domain`, NOT in either service's `/contracts`. See
  `docs/architecture/SYSTEM-ARCHITECTURE.md` §"Typed-subject contracts" rule 2.
- Consumers read the subject via `parseSubject(carrier, <ProducerSchema>)` — never
  `event.subject as <Type>` / `as Record<string,unknown>`.

Enforced by `tools/check-typed-subjects.mjs` (nx target
`event-processor:typed-subject-drift`, also pre-commit). A genuinely-polymorphic reader
(KB-stringify, agent fan-in) gets a registered entry in
`tools/typed-subject-exclusions.json` with a reason.

- [ ] 6. **Write unit tests** per `testing-patterns`
- [ ] 7. **Run unit tests** — `pnpm nx test {service-name}`
- [ ] 7b. **Add integration tests** — invoke `create-integration-test` skill. Ensure `project.json` includes the `test-integration` target:
  ```json
  "test-integration": {
    "executor": "nx:run-commands",
    "options": {
      "command": "pnpm jest --config services/{domain}/{service-name}/jest.integration.config.js --passWithNoTests",
      "env": { "NODE_OPTIONS": "--experimental-vm-modules" },
      "color": true
    }
  }
  ```
  And create `jest.integration.config.js`:
  ```js
  const preset = require('../../../jest.preset');
  module.exports = {
    ...preset,
    displayName: '{service-name}-integration',
    testEnvironment: 'node',
    testMatch: ['<rootDir>/test/integration/**/*.integration.test.ts'],
    moduleNameMapper: {
      '^@nestfolio/test-support$': '<rootDir>/../../../libs/test-support/src/index.ts',
      '^@nestfolio/test-support/(.*)$': '<rootDir>/../../../libs/test-support/src/$1',
      '^@nestfolio/integration-testing$': '<rootDir>/../../../libs/integration-testing/src/index.ts',
      '^@nestfolio/integration-testing/(.*)$': '<rootDir>/../../../libs/integration-testing/src/$1',
    },
    transform: {
      '^.+\\.[tj]sx?$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json', diagnostics: false }],
    },
    transformIgnorePatterns: ['node_modules/(?!.*p-limit/|.*yocto-queue/)'],
    testTimeout: 120_000,
    maxWorkers: 1,
    setupFilesAfterEnv: ['<rootDir>/../../../libs/integration-testing/src/jest.integration.setup.ts'],
  };
  ```
- [ ] 8. **Generate service card** — invoke `audit-service`
- [ ] 9. **Create C3 diagram** — add `docs/architecture/c3/{service-name}.d2` and wire layer import in `nestfolio.d2`, then invoke `generate-c4-diagrams`
- [ ] 10. **Wire adapter subscription** if cross-domain events (consuming adapter deploys EB rule on source bus)
- [ ] 11. **Commit**

## AgentRuntime Service Template

For services with Bedrock AgentCore agents, add the AgentRuntime construct and build-agent target:

The agent code lives at `services/{domain}/{service-name}/agents/{agent-name}/`, containing `graph.ts` (LangGraph entry), `server.ts` (Hono entry, listens on port 8080), and `Dockerfile` (ARM64 node:20-slim base, copies `dist/bundle.js`). Use a kebab-case `{agent-name}` (e.g. `decision-lifecycle`, `investor-profile`).

**project.json** — add build-agent target:
```json
{
  "targets": {
    "build-agent": {
      "executor": "nx:run-commands",
      "options": {
        "command": "npx esbuild services/{domain}/{service-name}/agents/{agent-name}/server.ts --bundle --platform=node --outfile=services/{domain}/{service-name}/agents/{agent-name}/dist/bundle.js --format=cjs --target=node20"
      }
    }
  },
  "tags": ["has-agent-runtime"]
}
```

**service.stack.ts** — add AgentRuntime construct:
```typescript
import * as path from 'path';
import { AgentRuntime } from '@nestfolio/cdk-constructs';

const agentRuntime = new AgentRuntime(this, 'AgentRuntime', {
  runtimeName: naming.functionName('agent'),
  agentCodePath: path.join(__dirname, '..', 'agents', '{agent-name}'),
  modelId: 'us.anthropic.claude-sonnet-4-6',
  tools: [
    { name: 'my-tool', description: '...', schemaPath: path.join(__dirname, 'tools/my-tool.schema.json'), handler: myToolLambda },
  ],
  // Create tools/<tool-name>.schema.json (JSON Schema) for each tool alongside its handler
});
```

**KnowledgeBase** — if the service needs RAG:
```typescript
import { KnowledgeBase } from '@nestfolio/cdk-constructs';

const kb = new KnowledgeBase(this, 'MyKB', {
  kbName: 'my-kb',
  description: 'Description of the knowledge base',
});
// Pass kb.knowledgeBaseId to Lambda env vars
// Note: KnowledgeBase construct handles IAM dependency ordering internally
// (cfnKb.node.addDependency on the KB role) — no manual wiring needed
```

## Reference Files
- Example ctrl: `services/execution/broker-ctrl/`
- Example adapter: `services/advisory/advisory-adpt/`
- Example hub: `services/execution/execution-hub/`

## Anti-Patterns
- NEVER omit the type suffix from service name
- NEVER place a service in the wrong domain
- NEVER create without tests or CDK stack
- NEVER leave a row's read-model ownership unclassified — register every written `__typename` (command-owned vs `Projection<'P1'|'P2'|'P3'>`) and use the matching intent factory (see `docs/architecture/READ-MODEL-OWNERSHIP.md`)
