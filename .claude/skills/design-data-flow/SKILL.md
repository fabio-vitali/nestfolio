---
name: design-data-flow
description: Framework for designing a cross-domain data flow — invokes brainstorming, flow-specific questions, produces implementation plan.
---

## When This Skill Applies
- Designing a new cross-domain business flow
- Redesigning an existing flow
- Planning flow changes for a feature

## Prerequisites
- Read `docs/architecture/SYSTEM-ARCHITECTURE.md` §18 (Cross-Domain Routing) for the pull-model topology
- Skim relevant `flows/*.flow.yaml` for similar existing flows (per `flows/SCHEMA.md` they are the canonical record)

## Process

### Step 0: Verify Architecture References (MANDATORY — before brainstorming)

The BACKLOG entry driving this design MUST list `**References:**` to the relevant `docs/architecture/SYSTEM-ARCHITECTURE.md` §X / `docs/architecture/SERVICE-INVENTORY.md` §Service / `flows/*.flow.yaml` it depends on (per `CLAUDE.md` § Backlog Discipline).

Before proceeding:
1. Read each cited reference.
2. Verify it still matches code (grep cited service paths, compare adapter ingestion lists in `services/{domain}/{domain}-adpt/src/service.stack.ts` to the cited flow yaml, run `validate-flow` on any cited `flows/*.flow.yaml`).
3. **If any reference is stale, STOP — fix the architecture doc first as its own workstream.** Do not design a flow on top of a stale flow yaml or stale arch §18.

### Step 1: Invoke Brainstorming
Invoke `superpowers:brainstorming` skill.

### Step 2: Flow-Specific Questions
**Trigger:** What starts it? Which service? User or system initiated?
**Domain Traversal:** Domains involved, order, events at each boundary, adapters needed?
**State Changes:** WriteIntent types per step, DDB key schemas?
**Idempotency:** Each step re-runnable? Dedup keys?
**Failure Modes:** Step N fails → consequence? Compensation? DLQ recovery? Circuit breakers?
**Observability:** Success signal? Metrics/alarms? Latency budget?

### Step 3: Implementation Plan
After approval, invoke `superpowers:writing-plans` using `create-data-flow` as execution framework.

## Anti-Patterns
- NEVER skip Step 0 architecture-reference verification — the BACKLOG entry's cited refs must match code before any design begins
- NEVER design without mapping the complete event chain
- NEVER skip failure mode analysis
- NEVER skip existing flow pattern reuse
- NEVER use direct service-to-service calls
