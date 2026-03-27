---
name: design-service
description: Framework for designing a new service — invokes brainstorming, domain-specific questions, produces implementation plan.
---

## When This Skill Applies
- Designing a new service from requirements
- Evaluating new service vs. extending existing
- Planning a service split

## Process

### Step 1: Invoke Brainstorming
Invoke `superpowers:brainstorming` skill FIRST — this is a creative design task.

### Step 2: Domain-Specific Questions
After brainstorming, work through:

**Domain Ownership:** Which domain? Service type suffix?
**Responsibility:** Single responsibility? Explicit exclusions?
**State:** DDB table(s), key schema, streams needed? S3?
**Events:** Consumed from which buses? Produced via CDC/explicit? Cross-domain?
**Infrastructure:** Which CDK constructs? Step Functions? IAM?
**Flows:** Which existing flows affected? New flows?

### Step 3: Implementation Plan
After design approval, invoke `superpowers:writing-plans` using `create-service` as execution framework.

## Anti-Patterns
- NEVER skip brainstorming
- NEVER design across domain boundaries — split + adapters
- NEVER design without checking existing services first
