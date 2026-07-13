# Continuity Claude Code Execution View

- Run: `run-vs001`
- Session: `session-vs001-2`
- Working Set: `ws-continuity-vs001`
- Scope: `scope-continuity-vs001@1`
- Context Pack: `run-vs001@1`
- Pack lock digest: `050be66fe746bce73cb09f56cb0a677fbd08b3be50a0858d7a2b2661ba4fe793`
- Transcript dependency: **none**

## Objective
Implement and dogfood the minimum Continuity path that resumes a Claude Code-oriented Run from a verified repository-local Checkpoint without transcript reconstruction or duplicate effects.

## Completion criteria
- [ ] `core-implementation-tests` — The bounded Core/store/Pack behavior passes deterministic unit tests.
- [ ] `keyed-effect-materialized` — The material dogfood file effect exists with the expected content.
- [ ] `resume-contract-observable` — Canonical artifacts prove two Sessions, a verified Checkpoint, a published Handoff, a passing resume check, and one completed keyed effect.
- [ ] `learning-not-promoted` — A candidate Lesson and an unsafe rejected Lesson exist, and neither changed a Skill or Guard automatically.

## Scope exclusions
- Existing Nestfolio business applications, services, infrastructure, and domain code.
- Current runtime feature families outside the minimum concepts reused by VS-001.
- External backlog or CI mutation.
- Parallel fan-out, Epic orchestration, deploy/release, hosted collaboration, RBAC, analytics, and universal Console.

## Resolved procedures
- `resumable-agent-work` from `continuity-core@0.1.0-vs001` via `.claude/skills/continuity-resumable-work/SKILL.md`
- `nestfolio-backlog-and-evidence` from `nestfolio-binding@0.1.0-vs001` via `.claude/skills/continuity-nestfolio-binding/SKILL.md`

## Applicable Guards
- `nestfolio-vs001-bounded-scope@1`

## Accepted Decisions
- `vs001-accepted-architecture-decisions@1`

## Exact next action
Resume in a fresh Session, verify the keyed effect is deduplicated, record learning, validate, and complete.

Use only canonical artifacts and this adapter-produced view. Do not reconstruct state from an earlier chat.

