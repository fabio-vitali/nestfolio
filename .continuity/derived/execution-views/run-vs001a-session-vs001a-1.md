# Continuity Claude Code Execution View

- Run: `run-vs001a`
- Session: `session-vs001a-1`
- Working Set: `ws-continuity-vs001a`
- Scope: `scope-continuity-vs001a@1`
- Context Pack: `run-vs001a@1`
- Pack lock digest: `050be66fe746bce73cb09f56cb0a677fbd08b3be50a0858d7a2b2661ba4fe793`
- Transcript dependency: **none**

## Objective
Prove executor provenance for the accepted VS-001 slice with two genuine Claude Code Sessions on Run run-vs001a. Session 1 (session-vs001a-1) executes exactly one material keyed effect: node runtime/continuity/adapters/claude-code/cli.mjs effect --run-id run-vs001a --session-id session-vs001a-1 --key vs001a-material-effect --path continuity/dogfood/vs001a-effect.txt --content 'VS-001A keyed effect completed exactly once.' — then checkpoints with the exact next action 'Replay effect key vs001a-material-effect to prove deduplication, then validate and complete run-vs001a.' and interrupts to publish the Handoff before the Claude Code session ends. Session 2 (session-vs001a-2) is a separately invoked fresh Claude Code process that is resumed by the SessionStart hook from repository-local state, replays the same effect key/path/content to prove deduplicated: true, then runs validate and complete for run-vs001a.

## Completion criteria
- [ ] `vs001a-deterministic-tests` — The session hooks, provenance validator, and bounded Core/store/Pack behavior pass deterministic unit tests.
- [ ] `vs001a-keyed-effect-materialized` — The material keyed effect file exists with the expected content: continuity/dogfood/vs001a-effect.txt containing 'VS-001A keyed effect completed exactly once.'
- [ ] `actual-adapter-bootstrap` — Genuine Claude Code Session 1 began from a real recorded Claude Code startup and received the adapter-produced start execution view (digest-matched, injected into context by the SessionStart hook).
- [ ] `actual-first-session-end` — Genuine Claude Code Session 1 ended (SessionEnd hook recorded the real session id, termination reason, and timestamp) after a verified Checkpoint and a published transcript-independent Handoff.
- [ ] `actual-fresh-session-resume` — A distinct genuine Claude Code Session 2 (different real Claude Code session id, source=startup, never a transcript resume) resumed the Run from repository-local Continuity state through the adapter-produced resume view.
- [ ] `effect-deduplication-confirmation` — The second execution of the stable effect key vs001a-material-effect returned deduplicated: true and exactly one completed effect record exists.

## Scope exclusions
- Continuity Core semantics and the accepted VS-001 artifacts (run-vs001 is never rerun or rewritten).
- Existing Nestfolio business applications, services, infrastructure, and domain code.
- Migration of another current-runtime feature family, PX-001, MA-001, and later vertical slices.
- External backlog or CI mutation, external writes, parallel fan-out, multi-executor parity, and automatic Lesson or Guard promotion.
- The two Continuity Skill assets (Pack-locked; VS-001A must not modify them).

## Resolved procedures
- `resumable-agent-work` from `continuity-core@0.1.0-vs001` via `.claude/skills/continuity-resumable-work/SKILL.md`
- `nestfolio-backlog-and-evidence` from `nestfolio-binding@0.1.0-vs001` via `.claude/skills/continuity-nestfolio-binding/SKILL.md`

## Applicable Guards
- `nestfolio-vs001a-bounded-scope@1`

## Accepted Decisions
- `vs001a-accepted-architecture-decisions@1`

## Exact next action
Execute the authorized keyed dogfood effect, then checkpoint.

Use only canonical artifacts and this adapter-produced view. Do not reconstruct state from an earlier chat.

