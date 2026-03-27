---
name: design-data-flow
description: Framework for designing a cross-domain data flow — invokes brainstorming, flow-specific questions, produces implementation plan.
---

## When This Skill Applies
- Designing a new cross-domain business flow
- Redesigning an existing flow
- Planning flow changes for a feature

## Prerequisites
- Read `domains` skill for event topology

## Process

### Step 1: Invoke Brainstorming
Invoke `superpowers:brainstorming` skill FIRST.

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
- NEVER design without mapping the complete event chain
- NEVER skip failure mode analysis
- NEVER skip existing flow pattern reuse
- NEVER use direct service-to-service calls
