---
name: generate-c4-diagrams
description: Regenerate C4 architecture diagrams from CDK stacks. Two-stage pipeline — Stage 1 generates D2 sources from service.stack.ts, Stage 2 compiles SVGs. Use after creating/renaming services, changing CDK stacks, or when diagrams are stale.
---

## When This Skill Applies
- After creating a new service or renaming/removing services
- After changing CDK stack constructs (State/Ingress/Egress/Facade/AgentRuntime/Orchestration/KnowledgeBase/AgentMemory)
- After modifying cross-domain adapter rules or hub event bus configuration
- After manual edits to any `docs/architecture/c3/*.d2` or `nestfolio.d2` (Stage 2 only)
- User invokes `/generate-c4-diagrams`

## What It Does

Two-stage pipeline that generates navigable C4 architecture diagrams from CDK code:

### Stage 1: D2 Source Generation (`tools/generate-c4-sources.mjs`)
Scans `services/{domain}/{service}/src/service.stack.ts` files and generates:
- **C3 D2 files** — one per service in `docs/architecture/c3/`
- **Root nestfolio.d2** — global styles + C1 system context + C2 domain layers with service classification

Parses 8 high-level constructs: State, Ingress, Egress, Facade, Orchestration, AgentRuntime, KnowledgeBase, AgentMemory
Plus raw CDK resources: EventBus, Archive, Rule, Lambda, Bucket, UserPool, Distribution, Schedule, resolveBusArn

Service classification for C2: hubs (has EventBus), cross-domain adapters (has EventBusTarget rules), data adapters (has Schedule or `-adpt` suffix with State), frontends (has Distribution or `-web` suffix), regular services (everything else)

### Stage 2: SVG Rendering (`tools/generate-c4-diagrams.mjs`)
Compiles `nestfolio.d2` → navigable SVG tree with clickable C1→C2→C3 drill-down, embedded AWS icons, `.svg` extension fixup, and navigation link patching.

## Checklist

- [ ] 1. **Generate D2 sources from CDK stacks**
  ```bash
  node tools/generate-c4-sources.mjs
  ```
  Discovers all services, parses their stack files, writes C3 D2 files and root `nestfolio.d2`.

- [ ] 2. **Compile SVGs from D2 sources**
  ```bash
  node tools/generate-c4-diagrams.mjs
  ```
  Renders `nestfolio.d2` → `docs/architecture/nestfolio/**/*.svg`, adds `.svg` extensions, patches navigation links.

- [ ] 3. **Verify output** — spot-check that SVGs exist:
  ```bash
  ls docs/architecture/nestfolio/index.svg
  ls docs/architecture/nestfolio/c2-investor/c3-investor-bff.svg
  ```

- [ ] 4. **Run tests** (if D2 generation logic was changed):
  ```bash
  pnpm nx test tools --testPathPattern generate-c4-sources
  ```

## D2 Source Structure

```
docs/architecture/
  nestfolio.d2          # GENERATED — global styles, C1 system context, C2 domain layers, layer imports
  c3/                   # GENERATED — C3 diagrams (one per service)
    investor-bff.d2
    execution-ctrl.d2
    ...
  icons/                # AWS service SVG icons (referenced by classes)
  nestfolio/            # GENERATED — SVG output tree (DO NOT EDIT)
    index.svg           # C1 overview
    c2-investor/
      index.svg         # C2 domain view
      c3-investor-bff.svg
      ...
```

## C3 Diagram Patterns

The generator produces different C3 layouts based on service type:

### Standard Service (ctrl/bff)
Color-coded construct groups: Facade (purple), Ingress (yellow), State (blue), Egress (orange), Orchestration (green).
Each construct renders its internal resources (e.g., Ingress → Rule + SQS + DLQ + Lambda).
Flows auto-wired: Facade→State, Ingress→State, State.stream→Egress, Ingress→Orchestration→State.

### Hub
Raw EventBus + Archive nodes (no construct wrappers). `{domain}-bus → archive` flow.

### Cross-Domain Adapter
`direction: right`. Source bus → target bus(es) with DLQ per rule. Uses `resolveBusArn` detection for target domains.

### Data Adapter
State + Schedule → Lambda pattern. Schedule detected via `AdapterSchedule` construct.

### Web Frontend
CloudFront Distribution + Cognito UserPool + S3 Bucket + standalone Lambdas.

### AI Services
AgentRuntime (green, Bedrock AgentCore + MCP Gateway), KnowledgeBase (orange, Bedrock KB + S3), AgentMemory (teal).
Flows: Facade→AgentRuntime→KnowledgeBase, AgentRuntime→State, Orchestration→AgentMemory.

## Exported Functions (for testing/programmatic use)

`generate-c4-sources.mjs` exports:
- `discoverServices()` — returns `[{ domain, service, stackPath }]`
- `parseStack(src)` — returns `{ constructs: {...}, raw: {...} }`
- `generateC3(service, domain, parsed)` — returns D2 string for a single service
- `generateC1(domains)` — returns D2 string for system context
- `generateC2(domain, services, parsedStacks)` — returns D2 string for a domain layer
- `generateGlobalStyles()` — returns D2 string for classes and global config

## Anti-Patterns
- NEVER edit generated D2 files or SVGs directly — they are generated artifacts; change the generator or CDK stacks instead
- NEVER render C3 files standalone (`d2 c3/foo.d2`) — icons won't load; always render from the parent `nestfolio.d2`
- NEVER commit D2/SVG changes without running both stages
- NEVER skip Stage 1 after CDK stack changes — the D2 sources must be regenerated first
