# Governance and Compliance Architecture

Defines Nestfolio's internal governance, compliance controls, and AI oversight mechanisms. This document covers controls operated by Nestfolio as a technology platform provider; the licensed investment partner maintains independent regulatory responsibility.

> [Back to Index](../README.md)

---

## Governance Scope

Nestfolio's governance framework encompasses six domains:

| Domain | Focus |
|---|---|
| AI Decision Governance | Traceability, explainability, and controlled autonomy for portfolio-impacting decisions |
| Model Lifecycle Governance | Promotion pipeline, versioning, and registry management |
| Operational Safety | Human-in-the-loop roles and privileged action controls |
| Incident Response | Autonomous containment with mandated human recovery approval |
| Data Protection | Layered retention, PII handling, and anonymization |
| Security | Tenant isolation, access control, and secrets management |

Regulated investment responsibility -- including discretionary authority and investor protection obligations -- remains outside Nestfolio's internal scope.

## AI Governance Principles

### Deterministic Accountability

Every portfolio-impacting decision must be traceable to four artifacts:

1. **Decision Packet** -- the structured input that triggered the decision.
2. **Model version** -- the exact model revision that produced the output.
3. **Policy set** -- the compliance and guardrail rules active at decision time.
4. **Context Bundle** -- the market data, portfolio state, and user profile used as context.

### Explainability by Design

Reasoning Factors are persisted at the moment of each decision. This ensures that explanations can be replayed exactly as they were generated, independent of any subsequent model or data changes.

### Controlled Autonomy

Autonomous actions execute only within mandate guardrails. Compliance Agents validate every proposed action against the active policy set before execution proceeds.

## Model Governance

### Governed Promotion Pipeline

All models progress through a four-stage pipeline before reaching production:

| Stage | Description |
|---|---|
| **1. Offline Evaluation** | Backtested against historical data; performance and safety metrics assessed |
| **2. Shadow Mode** | Runs in parallel with production models; outputs logged but not acted upon |
| **3. Limited Rollout** | Serves a controlled subset of decisions under enhanced monitoring |
| **4. Promotion** | Full production deployment after explicit AI Governance Reviewer approval |

No model reaches production without explicit sign-off from an AI Governance Reviewer.

### Model Registry

Each registered model entry includes:

- `model_id` -- unique identifier.
- `version` -- semantic version tag.
- `evaluation_results` -- metrics from offline evaluation and shadow mode.
- `approval_metadata` -- reviewer identity, timestamp, and approval conditions.

Historical decisions remain immutable regardless of subsequent model upgrades. A decision made under model version N is always attributable to version N, even after version N+1 is promoted.

## Operational Governance

### Human-in-the-Loop Roles

| Role | Scope |
|---|---|
| **Platform Operator** | Infrastructure management, deployment, and runtime operations |
| **Compliance Reviewer** | Regulatory alignment checks and compliance approval for recovery actions |
| **AI Governance Reviewer** | Model promotion approval and AI safety oversight |
| **Customer Support** | Tenant-scoped, read-only access to user-facing data for issue resolution |

All privileged actions -- regardless of role -- are recorded in the immutable audit log.

## Incident Governance

Nestfolio applies autonomous containment during incidents, followed by mandated human oversight for recovery:

**Autonomous containment actions:**
- Execution pause (tenant-scoped or global)
- Guardrail tightening
- Model rollback to last known-good version
- Reconciliation lock

**Recovery protocol:**
Recovery from any containment state requires authorized human approval. No automated process may resume execution, release locks, or widen guardrails without explicit operator and compliance sign-off.

## Data Governance

### Layered Retention Model

Data is organized into three retention layers, each with distinct lifecycle rules:

| Layer | Contents | Retention Policy |
|---|---|---|
| **PII Layer** | User identity, contact details, KYC artifacts | Deletable upon user request (right-to-erasure) |
| **Operational Layer** | Session data, feature flags, runtime telemetry | Retained per operational policy; rotated periodically |
| **Financial and Audit Layer** | Transaction records, decision packets, compliance events | Retained in anonymized form even after PII deletion |

When a user exercises their right to erasure, PII is removed while audit history is preserved in a fully anonymized, non-reversible form.

## Security Governance

### Tenant Isolation

Tenant boundaries are enforced at every layer of the stack:

- **Authentication:** JWTs include a `tenant_id` claim validated on every request.
- **Authorization:** Attribute-Based Access Control (ABAC) policies enforce partition isolation across all services.
- **Agent Invocations:** All agent calls are scoped by `tenant_id`, preventing cross-tenant data access.

### Secrets Handling

Delegated broker authorization artifacts (API keys, tokens, and credentials) are stored in tenant-scoped secure vaults. No secrets are persisted in application configuration, environment variables, or source code.

## Auditability

All governance actions emit immutable events to the audit log. Key event types include:

| Event | Trigger |
|---|---|
| `ModelPromotionApproved` | AI Governance Reviewer approves a model for production |
| `ExecutionPaused` | Autonomous or manual execution halt |
| `ComplianceApprovalGranted` | Compliance Reviewer signs off on a recovery or promotion |
| `OperatorActionPerformed` | Any privileged operator action |

Audit records support both real-time monitoring and forensic replay analysis.
