# Nestfolio — Volume 3: Governance & Compliance Architecture

## 1. Purpose
This volume defines Nestfolio’s internal governance, compliance, and AI control mechanisms. It focuses exclusively on controls operated by Nestfolio as a technology platform provider.

External licensed investment partners maintain independent regulatory responsibility.

---

## 2. Governance Scope
Nestfolio governance covers:
- AI decision governance
- Operational safety controls
- Auditability
- Security and data protection
- Incident response
- Model lifecycle governance

Regulated investment responsibility remains outside Nestfolio’s internal scope.

---

## 3. AI Governance Principles

### Deterministic Accountability
All portfolio-impacting decisions must be traceable to:
- Decision Packet
- Model version
- Policy set
- Context Bundle

### Explainability by Design
Reasoning Factors are persisted at decision time to ensure replayable explanations.

### Controlled Autonomy
Autonomous actions operate only within mandate guardrails validated by Compliance Agents.

---

## 4. Model Governance

### Governed Promotion Pipeline
Models progress through:
1. Offline evaluation
2. Shadow mode
3. Limited rollout
4. Promotion

Promotion requires explicit approval by AI Governance Reviewer.

### Model Registry
Each model entry includes:
- model_id
- version
- evaluation results
- approval metadata

Historical decisions remain immutable regardless of model upgrades.

---

## 5. Operational Governance

### Human‑in‑the‑Loop Roles
- Platform Operator
- Compliance Reviewer
- AI Governance Reviewer
- Customer Support (tenant-scoped, read-only)

All privileged actions are audit logged.

---

## 6. Incident Governance

Nestfolio applies autonomous containment with human oversight:
- Automatic execution pause
- Guardrail tightening
- Model rollback
- Reconciliation lock

Recovery requires authorized human approval.

---

## 7. Data Governance

### Layered Retention Model
Data domains:
- PII Layer
- Operational Layer
- Financial & Audit Layer

PII deletable upon request; audit history retained in anonymized form.

---

## 8. Security Governance

### Tenant Isolation
- JWT includes tenant_id claim
- ABAC policies enforce partition isolation
- Agent invocations scoped by tenant_id

### Secrets Handling
Delegated broker authorization artifacts stored in tenant-scoped secure vaults.

---

## 9. Auditability

All governance actions emit immutable events including:
- ModelPromotionApproved
- ExecutionPaused
- ComplianceApprovalGranted
- OperatorActionPerformed

Audit records support replay and forensic analysis.

---

## 10. Relationship to Other Volumes
- Volume 1 defines product intent.
- Volume 2 defines technical implementation.
- Volume 4 defines operational deployment and resilience.

