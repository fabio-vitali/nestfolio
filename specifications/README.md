# Nestfolio System Specifications

Nestfolio is an AI-managed investment platform designed for novice investors. It acts as a digital financial coach that autonomously manages portfolio allocation, rebalancing, and execution while prioritizing trust, transparency, and regulatory compliance. The platform operates through a licensed partner model with Interactive Brokers as custodian, launching first in Italy.

The system is built on an event-driven, serverless architecture using CQRS and Event Sourcing patterns. It runs as an Nx monorepo on AWS, with multi-tenant isolation, explainable AI decisions, and full audit trails for regulatory compliance.

---

## Table of Contents

### 01 — [Product Vision and Principles](./01-product-vision.md)

Product mission, target users, experience principles, and operating philosophy. Defines the conceptual foundation that drives all technical and operational decisions — including trust model, communication philosophy, and the three operating modes (Conservative, Balanced, Aggressive).

### 02 — [System Architecture](./02-system-architecture/README.md)

High-level architectural design: system goals, domain decomposition into four areas (User Experience, AI Advisory, Execution, Compliance & Trust), and the logical architecture that connects them.

| Document | Description |
|----------|-------------|
| [Agent System](./02-system-architecture/agent-system.md) | AI agent topology, decision lifecycle, reasoning model, and compliance validation |
| [Portfolio Management](./02-system-architecture/portfolio-management.md) | Portfolio operations, rebalancing logic, execution flow, and broker integration |

### 03 — [Event-Driven Architecture](./03-event-driven-architecture.md)

Domain-agnostic architectural patterns governing every backend service. Covers the service taxonomy (BFF, CTRL, ADPT, Event Hub), bus-per-domain topology, event contracts, routing patterns, and CQRS/Event Sourcing as architectural decisions.

### 04 — [Service Decomposition](./04-service-decomposition/README.md)

Bounded contexts, domain boundaries, data ownership, and the concrete mapping of business capabilities to services using the patterns from the Event-Driven Architecture specification.

| Document | Description |
|----------|-------------|
| [Service Inventory](./04-service-decomposition/service-inventory.md) | Complete listing of all services organized by domain, with responsibilities and event contracts |
| [Event Flows](./04-service-decomposition/event-flows.md) | Inter-domain event routing, cross-domain subscription matrix, and primary flow descriptions |

### 05 — [Implementation Patterns](./05-implementation-patterns/README.md)

Technology stack (Nx, AWS CDK, Node.js, TypeScript), monorepo structure, naming conventions, and the four-construct service pattern that every service follows.

| Document | Description |
|----------|-------------|
| [Code Patterns](./05-implementation-patterns/code-patterns.md) | Lambda handlers, DI, stream processing, CQRS with DynamoDB, multi-tenancy, error handling, observability, and implementation guardrails |
| [Testing](./05-implementation-patterns/testing.md) | Unit testing approach, integration testing with LocalStack, test structure and conventions |

### 06 — [Governance and Compliance](./06-governance-compliance.md)

Internal governance, compliance controls, and AI oversight mechanisms. Covers model promotion pipelines, human-in-the-loop roles, incident governance, data retention, security governance, and auditability requirements.

### 07 — [Operations and Deployment](./07-operations-deployment.md)

Production operations: deployment model, five controlled flight phases (from internal simulation to full production), observability dashboards, key signals, incident response, disaster recovery, and runbooks.

### 08 — [UI/UX](./08-ui-ux/README.md)

Design philosophy, constraints, accessibility standards (WCAG 2.1 AA), and localization strategy (Italy-first). Defines the trust-first, mobile-first user experience.

| Document | Description |
|----------|-------------|
| [Screen Inventory](./08-ui-ux/screen-inventory.md) | Complete screen specifications mapped to bounded contexts and BFF services, responsive layouts, and component specifications |
| [Interaction Patterns](./08-ui-ux/interaction-patterns.md) | User flows, real-time update behavior, and microfrontend architecture strategy |

---

## How Documents Relate

```
Product Vision (01)
    ↓ drives
System Architecture (02)
    ↓ decomposes into
Event-Driven Architecture (03)  ←  architectural patterns
    ↓ applied by
Service Decomposition (04)      ←  concrete services & flows
    ↓ implemented via
Implementation Patterns (05)    ←  code-level guidance

Governance & Compliance (06)    ←  cross-cutting: controls & oversight
Operations & Deployment (07)    ←  cross-cutting: production operations
UI/UX (08)                      ←  user-facing layer, consumes BFF services from (04)
```

## Reading Guides

**New to the project?** Start with [Product Vision](./01-product-vision.md), then [System Architecture](./02-system-architecture/README.md) for the big picture, then [Event-Driven Architecture](./03-event-driven-architecture.md) to understand how services communicate.

**Building a service?** Read [Event-Driven Architecture](./03-event-driven-architecture.md) for the patterns, find your service in [Service Decomposition](./04-service-decomposition/README.md), then follow [Implementation Patterns](./05-implementation-patterns/README.md) for the code.

**Operating the platform?** Read [Operations and Deployment](./07-operations-deployment.md) and [Governance and Compliance](./06-governance-compliance.md).

**Designing UI?** Start with [UI/UX](./08-ui-ux/README.md) for design philosophy, then [Screen Inventory](./08-ui-ux/screen-inventory.md) for screen specs and [Interaction Patterns](./08-ui-ux/interaction-patterns.md) for user flows.
