# Governance, Compliance, and Operations

Controls operated by Nestfolio as a technology platform. The licensed investment partner maintains independent regulatory responsibility.

---

## AI Governance

Every portfolio-impacting decision is traceable to: Decision Packet, model version, policy set, and Context Bundle. Reasoning Factors are persisted at decision time for deterministic replay. Simulation accounts operate under identical governance.

### Model Promotion Pipeline

| Stage | Description |
|---|---|
| Offline Evaluation | Backtested against historical data |
| Shadow Mode | Parallel with production, outputs logged, not acted upon |
| Limited Rollout | Controlled subset, enhanced monitoring |
| Promotion | Full production after AI Governance Reviewer approval |

No model reaches production without explicit human sign-off. Rollback available at all stages.

---

## Operational Roles

| Role | Scope |
|---|---|
| Platform Operator | Infrastructure, deployment, runtime operations |
| Compliance Reviewer | Regulatory alignment, recovery approval |
| AI Governance Reviewer | Model promotion, AI safety oversight |
| Customer Support | Tenant-scoped, read-only access |

All privileged actions recorded in immutable audit log.

---

## Incident Response

**Autonomous containment:** execution pause, reconciliation lock, model rollback, guardrail tightening.

**Human recovery:** no automated process may resume execution or widen guardrails without explicit operator + compliance sign-off.

| Severity | Example | Automatic Action |
|---|---|---|
| SEV-1 | Market data disruption | Agent retry |
| SEV-2 | Broker streaming loss | Execution pause |
| SEV-3 | Portfolio drift mismatch | Reconciliation lock |
| SEV-4 | Model anomaly | Model rollback |
| SEV-5 | Systemic risk | Global execution freeze |

---

## Controlled Flight Phases

| Phase | Description | Mode |
|---|---|---|
| 0 - Internal Simulation | Shadow decisions, no real capital | -- |
| 1 - Sandbox Capital | Limited internal portfolios, real capital | Conservative only |
| 2 - Limited Beta | Small external cohort, tight limits | Limited |
| 3 - Controlled Production | Gradual onboarding | Balanced default |
| 4 - Full Production | All modes enabled | All |

Each phase transition requires compliance sign-off and stability metrics.

---

## Data Protection

| Layer | Contents | Retention |
|---|---|---|
| PII | Identity, contacts, KYC | Deletable on request |
| Operational | Sessions, telemetry | Rotated periodically |
| Financial/Audit | Decisions, transactions | Retained anonymized (10+ years) |

Right-to-erasure: PII removed, audit history preserved in anonymized form.

## Security

- **Tenant isolation** at every layer: JWT `tenant_id` claim, ABAC policies, scoped agent invocations
- **Secrets**: broker credentials in tenant-scoped vaults, never in config/env/code/logs
