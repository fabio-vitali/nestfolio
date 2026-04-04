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
      domain/index.ts
    test/
      service.stack.test.ts
      {first-handler}.test.ts
    project.json                   <- projectType: "application", deploy/destroy/test/lint targets
    jest.config.js                 <- extends jest.preset, moduleNameMapper for @nestfolio/*
    tsconfig.json
    tsconfig.lib.json
    tsconfig.spec.json
  ```

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

- [ ] 3. **Write CDK stack** — extend ServiceStack with `serviceDir: __dirname`, create State explicitly (if needed), add Ingress/Egress/Orchestration per `cdk-patterns` (6-construct model)
  ```ts
  super(scope, id, { ...props, serviceDir: __dirname });
  ```
  - All services that need DynamoDB: `const state = new State(this, 'State'); this.state = state;`
  - Pass `state` to Ingress, Egress, Facade, AgentRuntime as needed
  - For orchestrated services (-ctrl with Step Functions): add `new Orchestration(this, 'MyStateMachine', { state, definitionBody, triggers })`
  - Call `this.addObservability({ ingress, egress })` at end of constructor
- [ ] 4. **Write first handler** per `event-processor-patterns`
- [ ] 5. **Define event types** per `create-event`
- [ ] 6. **Write tests** per `testing-patterns`
- [ ] 7. **Run tests** — `pnpm nx test {service-name}`
- [ ] 8. **Generate service card** — invoke `audit-service`
- [ ] 9. **Create C3 diagram** — add `docs/architecture/c3/{service-name}.d2` and wire layer import in `nestfolio.d2`, then invoke `generate-c4-diagrams`
- [ ] 10. **Wire adapter subscription** if cross-domain events (consuming adapter deploys EB rule on source bus)
- [ ] 11. **Commit**

## AgentRuntime Service Template

For services with Bedrock AgentCore agents, add the AgentRuntime construct and build-agent target:

**project.json** — add build-agent target:
```json
{
  "targets": {
    "build-agent": {
      "executor": "nx:run-commands",
      "options": {
        "command": "esbuild src/agent/index.ts --bundle --platform=node --target=node20 --outdir=dist/agent",
        "cwd": "services/{domain}/{service}"
      }
    }
  },
  "tags": ["has-agent-runtime"]
}
```

**service.stack.ts** — add AgentRuntime construct:
```typescript
import { AgentRuntime } from '@nestfolio/cdk-constructs';

const agentRuntime = new AgentRuntime(this, 'AgentRuntime', {
  runtimeName: naming.functionName('agent'),
  agentEntryPath: join(__dirname, '../dist/agent'),
  modelId: 'us.anthropic.claude-sonnet-4-6',
  tools: [
    { name: 'my-tool', description: '...', schemaPath: join(__dirname, 'tools/my-tool.schema.json'), handler: myToolLambda },
  ],
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
```

## Reference Files
- Example ctrl: `services/execution/broker-ctrl/`
- Example adapter: `services/advisory/advisory-adpt/`
- Example hub: `services/execution/execution-hub/`

## Anti-Patterns
- NEVER omit the type suffix from service name
- NEVER place a service in the wrong domain
- NEVER create without tests or CDK stack
