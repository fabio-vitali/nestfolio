# Implementation Patterns

Technology stack, monorepo structure, naming conventions, and foundational implementation decisions for Nestfolio.

> [Back to Index](../README.md)

## Documents in This Section

| Document | Description |
|----------|-------------|
| [Code Patterns](./code-patterns.md) | Lambda handlers, DI, stream processing, CQRS, multi-tenancy, error handling, observability, and implementation guardrails |
| [Testing](./testing.md) | Unit testing approach, integration testing with LocalStack, test structure and conventions |

---

## Tech Stack

| Technology | Version / Variant | Role |
|------------|-------------------|------|
| **Nx** | v19 | Monorepo orchestration with workspace layout and affected-based builds |
| **AWS CDK** | v2 | Infrastructure as Code, TypeScript-native |
| **Projen** | Latest | Configuration generation (auto-generates `package.json`, `tsconfig.json`, etc.) |
| **Node.js** | 20 LTS | Lambda runtime |
| **TypeScript** | 5.x | Language for all application and infrastructure code |
| **pnpm** | Latest | Package management with workspace support |
| **Highland.js** | Latest | Functional stream processing for event pipelines |
| **Awilix** | Latest | Dependency injection container (CLASSIC mode, `strict: true`) |
| **AWS Lambda Powertools** | Latest | Structured logging, custom metrics, distributed tracing |
| **Mutative** | Latest | Immutable state management with RFC 6902 JSON Patch output |

---

## Monorepo Structure

```
/
├── services/
│   └── {domain}/                     # Domain grouping (e.g., portfolio, auth)
│       └── {service-name}/            # Service with suffix (-bff, -ctrl, -adpt)
│           ├── src/
│           │   ├── main.ts            # CDK app entry point
│           │   ├── service.stage.ts   # CDK Stage with tags & context
│           │   ├── service.stack.ts   # Main stack composing 4 constructs
│           │   ├── pipeline.stack.ts  # CI/CD pipeline (optional)
│           │   ├── constructs/        # Service-specific CDK constructs
│           │   │   ├── state.ts       # DynamoDB tables, S3 buckets
│           │   │   ├── ingress.ts     # EventBridge -> SQS -> Lambda
│           │   │   ├── egress.ts      # DynamoDB Streams -> EventBridge
│           │   │   └── facade.ts      # AppSync/REST API
│           │   ├── handlers/          # Lambda implementations
│           │   │   ├── event-listener/
│           │   │   │   ├── handler.ts     # Lambda entry point
│           │   │   │   ├── pipeline.ts    # Highland.js stream orchestrator
│           │   │   │   ├── container.ts   # Awilix DI container
│           │   │   │   ├── service.ts     # Domain logic
│           │   │   │   └── pipes/         # Per-event processors
│           │   │   │       ├── portfolio-created.pipe.ts
│           │   │   │       └── portfolio-updated.pipe.ts
│           │   │   ├── event-publisher/
│           │   │   │   └── handler.ts     # DynamoDB Streams -> EventBridge
│           │   │   └── graphql-resolver/
│           │   │       └── handler.ts     # AppSync resolver
│           │   ├── models/
│           │   │   ├── events.ts      # Event type constants (SCREAMING_SNAKE)
│           │   │   └── domain.ts      # Domain types & interfaces
│           │   ├── repositories/      # Data access layer
│           │   │   ├── portfolio-table.repository.ts
│           │   │   └── portfolio-gql.repository.ts
│           │   └── graphql/           # BFF only
│           │       ├── schema.graphql
│           │       └── resolvers.ts
│           ├── test/                  # Unit & integration tests
│           ├── .projenrc.ts           # Projen configuration
│           └── project.json           # Nx project configuration
│
└── libs/
    ├── cdk-constructs/                # Reusable AWS CDK patterns
    │   ├── src/
    │   │   ├── default-lambda-props.ts
    │   │   ├── datadog-instrumentation.ts
    │   │   ├── replicable-table.ts
    │   │   └── replicable-bucket.ts
    │   └── project.json
    ├── lambda-utils/                  # Shared Lambda utilities
    │   ├── src/
    │   │   ├── bus.ts                 # EventBridge abstraction
    │   │   ├── pipe.ts                # Highland.js pipe interface
    │   │   ├── unit-of-work.ts        # Event context wrapper
    │   │   ├── errors.ts              # Error handling patterns
    │   │   ├── repositories/          # Base repository classes
    │   │   │   ├── table.repository.ts
    │   │   │   ├── gql.repository.ts
    │   │   │   └── bucket.repository.ts
    │   │   └── core.ts                # Core types & utilities
    │   └── project.json
    └── domain-core/                   # Domain models & events
        ├── src/
        │   ├── portfolio/
        │   │   ├── events.ts          # Event type definitions
        │   │   └── models.ts          # Domain entities
        │   └── shared/
        │       └── types.ts           # Shared types
        └── project.json
```

### Shared Libraries

| Library | Purpose | Contents |
|---------|---------|----------|
| `libs/cdk-constructs` | Reusable CDK patterns | Default Lambda props, Datadog instrumentation, replicable DynamoDB tables and S3 buckets |
| `libs/lambda-utils` | Shared Lambda runtime code | EventBridge bus abstraction, Highland.js pipe interface, unit-of-work wrapper, error classification, base repository classes |
| `libs/domain-core` | Domain contracts | Event type definitions, domain entity models, shared types |

---

## Service Naming Conventions

Every deployable service uses a suffix that indicates its architectural role.

| Suffix | Role | Example | Purpose |
|--------|------|---------|---------|
| `-web` | Web Frontend | `portfolio-web` | Frontend infrastructure, CloudFront distribution |
| `-event-hub` | Event Router | `portfolio-event-hub` | EventBridge bus for cross-domain routing |
| `-bff` | Backend-for-Frontend | `portfolio-viewer-bff` | GraphQL/REST API, CQRS command ingestion |
| `-ctrl` | Controller | `portfolio-publisher-ctrl` | Async orchestration, Step Functions workflows |
| `-adpt` | Adapter | `analytics-adpt` | External system integration, webhook handling |

---

## Four-Construct Service Pattern

Every service stack composes exactly four CDK constructs. For full code examples and implementation details, see [Code Patterns](./code-patterns.md).

| Construct | Responsibility | Typical AWS Resources |
|-----------|---------------|----------------------|
| **State** | Data layer | DynamoDB tables, S3 buckets |
| **Ingress** | Event consumption | EventBridge rule, SQS queue, Lambda consumer |
| **Egress** | Event publishing | DynamoDB Streams trigger, Lambda publisher, EventBridge |
| **Facade** | API surface | AppSync GraphQL, REST API Gateway, CloudFront |

---

## Code Conventions

| Convention | Rule |
|------------|------|
| Event type constants | `SCREAMING_SNAKE_CASE` via `as const` assertion |
| DynamoDB partition keys | `{EntityType}#{tenantId}#{entityId}` |
| DynamoDB sort keys | `{EntityType}` or `EditEvent#{timestamp}#{uuid}` or `{RelationType}#{id}` |
| Lambda handler files | `handler.ts` exports a bound instance method |
| DI container files | `container.ts` uses Awilix CLASSIC mode with `strict: true` |
| Stream pipeline files | `pipeline.ts` implements the `Pipe` interface |
| Per-event processors | `{event-name}.pipe.ts` in a `pipes/` subdirectory |
| Projen config | `.projenrc.ts` at service root |
| Nx project config | `project.json` at service root |
