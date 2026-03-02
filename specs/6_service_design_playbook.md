# Service Design Playbook

> Step-by-step playbook for decomposing any system into DDD bounded contexts, domain events, and microservices.
> Extracted from the full implementation architecture spec. Pair this document with a system specification to produce a concrete domain decomposition.

---

## 1. How to Identify Bounded Contexts (Domains)

A **domain** is a top-level directory under `services/{domain}/` in the Nx monorepo. Each domain:

- Owns its own data (DynamoDB tables, S3 buckets). **No shared databases across domains.**
- Owns its own domain events. Events are the **only** way domains communicate.
- Contains one or more microservices (see Section 3).
- Maps 1:1 to a DDD bounded context.

**Identification rules** — when reading system requirements, create a new domain when you find:

- A distinct area of responsibility with its own entities, lifecycle, and invariants.
- A set of state changes that can be fully described without referencing another domain's internals.
- A need for independent deployability, scaling, or team ownership.

**Cross-cutting infrastructure** (event routing, frontend hosting, CDN, DNS) belongs in a `platform` domain.

---

## 2. How to Identify Domain Events

### Naming Convention

- `SCREAMING_SNAKE_CASE` (e.g., `ORDER_SUBMITTED`, `USER_REGISTERED`).
- Defined as TypeScript `const` assertions in `models/events.ts` per service, and in `libs/domain-core/{domain}/events.ts` for cross-domain contracts.

### Event Structure

Every event on the bus follows this shape:

```
BusEvent {
  id:        string   — crypto.randomUUID()
  type:      string   — SCREAMING_SNAKE_CASE event name
  timestamp: string   — ISO 8601
  subject:   object   — event-specific payload (entity IDs, changed fields)
  context:   object   — always includes tenantId, userId, optional correlationId
}
```

### Identification rules — when reading system requirements, create a domain event when you find:

- A **state transition** in an entity (created, updated, deleted, status change).
- An **external signal** ingested into the platform (webhook received, snapshot imported).
- A **decision point** output (approved, rejected, escalated).
- A **workflow milestone** (step completed, orchestration finished).
- A **user action** with downstream consequences (registered, confirmed, revoked).

### Assignment rules — each event belongs to the domain that **produces** it:

- The producing domain publishes the event to EventBridge.
- Other domains subscribe to it via their Ingress constructs (EventBridge → SQS → Lambda).
- An event can be consumed by many domains but is owned by exactly one.

---

## 3. How to Determine Microservices per Domain

### Service Taxonomy

Every microservice name follows the pattern `{domain}-{qualifier?}-{suffix}`. The suffix determines the service's architectural role:

| Suffix | Role | When to assign |
|---|---|---|
| `-web` | Web / Identity Frontend | Domain needs Cognito auth, CloudFront distribution, or frontend hosting. Typically one per system, often in `auth` or `platform` domain. |
| `-event-hub` | Event Router | Central EventBridge bus, routing rules, event archive, schema registry. Exactly one per system, in the `platform` domain. |
| `-bff` | Backend-for-Frontend | Domain exposes data to users via GraphQL (AppSync). Handles command ingestion (mutations), materialized read projections (queries), and real-time subscriptions. |
| `-ctrl` | Controller | Domain has multi-step async orchestration (Step Functions), scheduled workflows, or complex event-driven processing that goes beyond simple CRUD. |
| `-adpt` | Adapter | Domain integrates with an external system (third-party API, broker, webhook provider). Translates between internal domain events and external API calls. |

### Assignment rules — for each domain identified in Section 1:

1. **Does the domain expose data to the UI?** → Add a `-bff` service.
2. **Does the domain orchestrate multi-step workflows, temporal logic, or saga coordination?** → Add a `-ctrl` service.
3. **Does the domain integrate with an external system?** → Add a `-adpt` service.
4. **Does the domain own user authentication or a web frontend?** → Add a `-web` service.
5. A domain can have **multiple services** (e.g., both a `-bff` and a `-ctrl`).
6. A domain must have **at least one** service.

### The 4-Construct Pattern

Every service (regardless of suffix) is internally composed of exactly 4 CDK constructs:

| Construct | Responsibility |
|---|---|
| **State** | DynamoDB tables, S3 buckets — the service's private data store |
| **Ingress** | EventBridge → SQS → Lambda — consumes domain events from other services |
| **Egress** | DynamoDB Streams → Lambda → EventBridge — publishes state changes as domain events |
| **Facade** | AppSync GraphQL, REST API, or CloudFront — the service's external API surface |

### Service-Type Specific Responsibilities

**`-bff`** owns: AppSync GraphQL API (mutations, queries, subscriptions), DynamoDB command store (single-table, partition key `tenantId#entityId`), Reducer Lambda (applies state from edit history), Event Publisher Lambda (CDC via DynamoDB Streams), S3 for microfrontend assets.

**`-ctrl`** owns: SQS queue subscribed to domain events, Event Listener Lambda, Step Functions state machine (orchestration, wait states, parallel states, retry/compensation), Event Publisher Lambda for orchestration completion events.

**`-adpt`** owns: SQS queue for inbound events, Event Consumer Lambda (transforms domain events → external API calls, handles retries), API Gateway REST API (webhook endpoints for external callbacks, rate limiting), Event Publisher Lambda (converts external responses → domain events).

**`-web`** owns: Cognito User Pool (federation, Lambda triggers for auth events), CloudFront distribution (path-based routing to BFF endpoints), Route53 hosted zone.

**`-event-hub`** owns: EventBridge custom bus (`platform-events`), event pattern routing rules to all service SQS queues, 90-day event archive with replay, Schema Registry, dead-letter queue.

---

## 4. Cross-Domain Communication Rules

- **All inter-service communication is asynchronous via EventBridge.** Zero synchronous calls.
- Events flow: producing service Egress → EventBridge → consuming service Ingress (SQS → Lambda).
- Every event carries `tenantId` in its context for strict multi-tenant isolation.
- Each service owns its own DynamoDB table(s). No shared storage.
- Frontends connect only via BFF AppSync endpoints, never directly to command/event stores.

---

## 5. Monorepo Layout

```
services/{domain}/{service-name}/    — one directory per microservice
libs/domain-core/{domain}/           — shared event types and domain models per domain
libs/lambda-utils/                   — shared Lambda utilities (bus, pipe, errors, repositories)
libs/cdk-constructs/                 — reusable CDK patterns
```

---

## 6. Guardrails

**MUST**: publish all state changes as domain events; include `tenantId` in every event context; use the 4-construct pattern; use SQS between EventBridge and Lambda; implement idempotency in all event handlers; use DynamoDB Streams for CDC; store state mutations as EditEvents (RFC 6902 JSON Patch).

**MUST NOT**: call other services directly (no HTTP/SDK between services); share databases between services; bypass EventBridge for inter-service communication; expose raw command/event stores to frontends; allow cross-tenant data access; implement synchronous request-response between services.
