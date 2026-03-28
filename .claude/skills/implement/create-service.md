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

- [ ] 1. **Create Nx project**
  ```bash
  pnpm nx g @nx/js:library services/{domain}/{service-name} --unitTestRunner=jest --bundler=none
  ```
  Verify flags with `--help` first.

- [ ] 2. **Set up file structure:**
  ```
  services/{domain}/{service-name}/
    src/
      service.stack.ts
      handlers/{first-handler}.ts
      domain/events.ts
      domain/index.ts
    test/
      service.stack.test.ts
      {first-handler}.test.ts
    project.json
  ```

- [ ] 3. **Write CDK stack** — extend ServiceStack, create State explicitly (if needed), add Ingress/Egress/Orchestration per `cdk-patterns` (6-construct model)
  - All services that need DynamoDB: `const state = new State(this, 'State', {}); this.state = state;`
  - Pass `state` to Ingress, Egress, Facade, AgentRuntime as needed
  - For orchestrated services (-ctrl with Step Functions): add `new Orchestration(this, 'MyStateMachine', { state, definitionBody, triggers })`
- [ ] 4. **Write first handler** per `event-processor-patterns`
- [ ] 5. **Define event types** per `create-event`
- [ ] 6. **Write tests** per `testing-patterns`
- [ ] 7. **Run tests** — `pnpm nx test {service-name}`
- [ ] 8. **Generate service card** — invoke `audit-service`
- [ ] 9. **Create C3 diagram** — add `docs/architecture/c3/{service-name}.d2` and wire layer import in `nestfolio.d2`, then invoke `generate-c4-diagrams`
- [ ] 10. **Wire adapter forwarding** if cross-domain events
- [ ] 11. **Commit**

## Reference Files
- Example ctrl: `services/execution/broker-ctrl/`
- Example adapter: `services/advisory/advisory-adpt/`
- Example hub: `services/execution/execution-hub/`

## Anti-Patterns
- NEVER omit the type suffix from service name
- NEVER place a service in the wrong domain
- NEVER create without tests or CDK stack
