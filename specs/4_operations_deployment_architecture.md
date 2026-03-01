# Nestfolio — Volume 4: Operations & Deployment Architecture

## 1. Purpose
This volume defines how Nestfolio operates, deploys, monitors, and recovers the production platform. Nestfolio fully owns day‑to‑day platform operations for MVP.

---

## 2. Operational Ownership Model
Nestfolio operates the platform end‑to‑end:
- Deployment and release management
- Runtime operations and SRE
- Incident response and recovery
- Monitoring and observability

Licensed partners interface via agreed integration and reporting channels but do not operate platform infrastructure.

---

## 3. Controlled Flight Phases

### Phase 0 — Internal Simulation
- Historical replay and shadow decisions
- No real capital

### Phase 1 — Sandbox Capital
- Controlled internal portfolios
- Conservative mode only

### Phase 2 — Limited User Beta
- Small user cohort
- Tight exposure limits
- Enhanced monitoring

### Phase 3 — Controlled Production
- Gradual onboarding
- Balanced mode default

### Phase 4 — Full Production
- All modes enabled
- Standard guardrails and monitoring

Advancement requires compliance sign‑off and stability metrics within thresholds.

---

## 4. Deployment Model
- Infrastructure as Code (IaC)
- Blue/Green or Canary releases
- Model promotions gated via governance pipeline
- Rollback capability preserved for all services

---

## 5. Observability & Mission Control

### Dashboards
- Operations Dashboard
- Compliance Dashboard
- AI Governance Dashboard

### Key Signals
- Agent success/failure
- Decision throughput
- Execution latency
- Reconciliation confidence
- Guardrail pressure index

Alerts map to incident severity (SEV‑1 → SEV‑5).

---

## 6. Incident Response

### Autonomous Containment
- Execution pause (tenant or global)
- Reconciliation lock
- Model rollback
- Guardrail tightening

### Human Oversight
- Operator review
- Compliance approval for recovery
- Controlled execution resume

All actions emit immutable incident events.

---

## 7. Disaster Recovery & Business Continuity

- Multi‑AZ deployment
- Event Store replication
- Projection rebuild from events
- Broker re‑sync on recovery
- Defined RTO/RPO targets (TBD)

---

## 8. Runbooks & Playbooks
Runbooks maintained for:
- Broker outage
- Streaming disconnect
- Reconciliation failure
- Model anomaly
- Region outage

Playbooks define detection, containment, communication, and recovery steps.

---

## 9. Production Readiness Gates
Before enabling autonomy:
- Model stability validated
- Reconciliation mismatch below threshold
- Incident rate acceptable
- Observability coverage verified

---

## 10. Release & Change Management
- Changes tracked as governance events
- Model/version pinning in Decision Packets
- Emergency rollback procedures documented

---

## 11. Relationship to Other Volumes
- Volume 1: Product & Principles
- Volume 2: System Architecture
- Volume 3: Governance & Compliance

