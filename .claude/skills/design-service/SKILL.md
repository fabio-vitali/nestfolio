---
name: design-service
description: Framework for designing a new service — invokes brainstorming, domain-specific questions, produces implementation plan.
---

## When This Skill Applies
- Designing a new service from requirements
- Evaluating new service vs. extending existing
- Planning a service split

## Process

### Step 0: Verify Architecture References (MANDATORY — before brainstorming)

The BACKLOG entry driving this design MUST list `**References:**` to the relevant `docs/architecture/SYSTEM-ARCHITECTURE.md` §X and/or `docs/architecture/SERVICE-INVENTORY.md` §Service it depends on (per `CLAUDE.md` § Backlog Discipline).

Before proceeding:
1. Read each cited reference.
2. Verify it still matches code (grep the cited service paths, compare service counts to `ls services/*/`, compare event lists to `events.ts`).
3. **If any reference is stale, STOP — fix the architecture doc first as its own workstream.** Do not design against stale arch docs.

### Step 1: Invoke Brainstorming
Invoke `superpowers:brainstorming` skill — this is a creative design task.

### Step 2: Domain-Specific Questions
After brainstorming, work through:

**Domain Ownership:** Which domain? Service type suffix?
**Responsibility:** Single responsibility? Explicit exclusions?
**State:** DDB table(s), key schema, streams needed? S3?
**Events:** Consumed from which buses? Produced via CDC/explicit? Cross-domain?
**Infrastructure:** Which of the 6 CDK constructs (State, Ingress, Egress, Facade, AgentRuntime, Orchestration)? Does this service need orchestration (Step Functions)?
**Flows:** Which existing flows affected? New flows?

### Step 3: Implementation Plan
After design approval, invoke `superpowers:writing-plans` using `create-service` as execution framework.

## Anti-Patterns
- NEVER skip Step 0 architecture-reference verification — the BACKLOG entry's cited refs must match code before any design begins
- NEVER skip brainstorming
- NEVER design across domain boundaries — split + adapters
- NEVER design without checking existing services first
