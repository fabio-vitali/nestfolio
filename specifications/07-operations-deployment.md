# Operations and Deployment Architecture

Defines how Nestfolio operates, deploys, monitors, and recovers the production platform. Nestfolio fully owns day-to-day platform operations for the MVP phase.

> [Back to Index](../README.md)

---

## Operational Ownership

Nestfolio operates the platform end-to-end across four disciplines:

| Discipline | Scope |
|---|---|
| **Deployment and Release Management** | Infrastructure provisioning, service releases, and model promotions |
| **Runtime Operations and SRE** | Availability, performance, and capacity management |
| **Incident Response and Recovery** | Detection, containment, communication, and resolution |
| **Monitoring and Observability** | Dashboards, alerting, and signal collection |

Licensed partners interface with the platform through agreed integration and reporting channels. Partners do not operate platform infrastructure.

## Controlled Flight Phases

Nestfolio advances through five progressive launch phases. Each phase increases exposure, autonomy, and user scope while maintaining strict safety gates.

### Phase 0 -- Internal Simulation

- Historical replay and shadow decision execution.
- No real capital at risk.
- Validates model behavior against known outcomes.
- The simulation engine developed for this phase is retained as production infrastructure -- the user-facing Simulation mode reuses the same engine, event schemas, and guardrail pipeline. Phase 0 work is not throwaway scaffolding; it becomes a permanent product capability.

### Phase 1 -- Sandbox Capital

- Controlled internal portfolios with real but limited capital.
- Conservative operating mode only.
- Validates execution pipeline end-to-end.

### Phase 2 -- Limited User Beta

- Small external user cohort.
- Tight exposure limits enforced.
- Enhanced monitoring and manual oversight active.

### Phase 3 -- Controlled Production

- Gradual user onboarding with Balanced mode as default.
- Standard guardrails with elevated alerting thresholds.

### Phase 4 -- Full Production

- All operating modes enabled.
- Standard guardrails and monitoring.
- System operates under normal operational parameters.

**Advancement criteria:** Each phase transition requires compliance sign-off and demonstrated stability metrics within defined thresholds.

## Deployment Model

| Capability | Approach |
|---|---|
| Infrastructure provisioning | Infrastructure as Code (IaC) |
| Release strategy | Blue/Green or Canary deployments |
| Model promotion | Gated via the governance promotion pipeline (see [Governance and Compliance](06-governance-compliance.md)) |
| Rollback | Preserved for all services; executable without downtime |

All deployments are automated, reproducible, and version-controlled.

## Observability and Mission Control

### Dashboards

Three dedicated dashboards provide operational visibility:

| Dashboard | Focus |
|---|---|
| **Operations Dashboard** | Service health, latency, throughput, and error rates |
| **Compliance Dashboard** | Guardrail pressure, compliance events, and approval status |
| **AI Governance Dashboard** | Model performance, shadow-mode comparison, and promotion pipeline status |

### Key Signals

The following signals are continuously monitored:

| Signal | Description |
|---|---|
| Agent success/failure rate | Percentage of agent invocations completing without error |
| Decision throughput | Number of portfolio decisions processed per unit time |
| Execution latency | End-to-end time from decision to broker execution |
| Reconciliation confidence | Degree of agreement between expected and actual portfolio state |
| Guardrail pressure index | Proximity of current parameters to guardrail boundaries |

### Alerting

Alerts map to a five-level incident severity scale (SEV-1 through SEV-5). Severity determines escalation path, response time targets, and containment actions.

## Incident Response

### Autonomous Containment

The platform applies automatic containment measures when anomalies are detected:

- **Execution pause** -- tenant-scoped or global, depending on severity.
- **Reconciliation lock** -- prevents further trades until state is verified.
- **Model rollback** -- reverts to the last known-good model version.
- **Guardrail tightening** -- reduces autonomy thresholds to limit blast radius.

### Human Oversight

After autonomous containment stabilizes the system, human operators take control:

1. **Operator review** -- assess root cause and containment effectiveness.
2. **Compliance approval** -- Compliance Reviewer authorizes recovery actions.
3. **Controlled execution resume** -- services are brought back online incrementally.

All incident actions -- both autonomous and human-initiated -- emit immutable audit events.

## Disaster Recovery and Business Continuity

| Capability | Implementation |
|---|---|
| High availability | Multi-AZ deployment |
| Event durability | Event Store replication across availability zones |
| State reconstruction | Projections rebuilt from the event stream |
| Broker synchronization | Re-sync with Interactive Brokers on recovery |
| Recovery targets | Defined RTO/RPO targets (to be finalized before Phase 2) |

## Runbooks and Playbooks

Operational runbooks are maintained for the following scenarios:

| Scenario | Coverage |
|---|---|
| Broker outage | Detection, user notification, execution queueing, re-sync on recovery |
| Streaming disconnect | Reconnection logic, data gap detection, backfill procedures |
| Reconciliation failure | Mismatch triage, automatic lock, manual resolution workflow |
| Model anomaly | Drift detection, automatic rollback, governance escalation |
| Region outage | Failover activation, DNS cutover, post-recovery verification |

Each playbook defines four stages: **detection**, **containment**, **communication**, and **recovery**.

## Production Readiness Gates

Before any phase enables autonomous decision-making, the following gates must be satisfied:

- [ ] Model stability validated against defined performance thresholds.
- [ ] Reconciliation mismatch rate below acceptable threshold.
- [ ] Incident rate within acceptable bounds over the observation window.
- [ ] Observability coverage verified across all critical services and signals.

## Release and Change Management

All production changes are governed through a structured change management process:

- **Change tracking:** Every release, configuration change, and model promotion is recorded as a governance event.
- **Version pinning:** Decision Packets reference exact model and service versions, ensuring reproducibility.
- **Emergency rollback:** Documented procedures enable rapid rollback of any service or model without data loss.
