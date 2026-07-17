# Continuity Claude Code Execution View

- Run: `run-mi005`
- Session: `session-mi005-2`
- Working Set: `ws-mi005`
- Scope: `scope-mi005-run-continuity@1`
- Context Pack: `run-mi005@1`
- Pack lock digest: `050be66fe746bce73cb09f56cb0a677fbd08b3be50a0858d7a2b2661ba4fe793`
- Transcript dependency: **none**

## Objective
MI-005 bounded Level 5 resumable-run continuity validation for the one target-routed effort.
Session 1 (session-mi005-1) executes exactly one material keyed effect:
node runtime/continuity/adapters/claude-code/cli.mjs effect --run-id run-mi005 --session-id session-mi005-1 --key mi005-material-effect --path continuity/dogfood/mi-005-effect.txt --content 'MI-005 resumable run cutover keyed effect completed exactly once.'
then checkpoints with the exact next action 'Replay effect key mi005-material-effect to prove deduplication, then capture the final Checkpoint and close run-mi005 at Level 5 operational scope only (do NOT run validate or complete).' and interrupts to publish the Handoff before the Claude Code session ends:
node runtime/continuity/adapters/claude-code/cli.mjs checkpoint --run-id run-mi005 --session-id session-mi005-1 --next-action "Replay effect key mi005-material-effect to prove deduplication, then capture the final Checkpoint and close run-mi005 at Level 5 operational scope only (do NOT run validate or complete)."
node runtime/continuity/adapters/claude-code/cli.mjs interrupt --run-id run-mi005 --session-id session-mi005-1 --reason deliberate-pause
Session 2 (session-mi005-2) is a separately launched fresh Claude Code process resumed by the SessionStart hook from repository-local state; it replays the same effect key/path/content to prove deduplicated:true, then captures the FINAL verified Checkpoint and ENDS. It must NOT run validate or complete (Level 5 operational closure only; no Work completion, Assurance, or Level 6 state):
node runtime/continuity/adapters/claude-code/cli.mjs effect --run-id run-mi005 --session-id session-mi005-2 --key mi005-material-effect --path continuity/dogfood/mi-005-effect.txt --content 'MI-005 resumable run cutover keyed effect completed exactly once.'
node runtime/continuity/adapters/claude-code/cli.mjs checkpoint --run-id run-mi005 --session-id session-mi005-2 --next-action "No execution action remains. Level 5 operational closure only; no Work completion, Assurance, or Level 6 state exists." --final 1

## Completion criteria
- [ ] `mi005-keyed-effect-materialized` — The material keyed effect file exists with the expected content: continuity/dogfood/mi-005-effect.txt containing the declared MI-005 effect content.

## Scope exclusions
- The selected effort implementation, its backlog source, and every Level 1-4 artifact.
- The entire current journal tree.
- Any Work completion, Evidence-bound completion, Assurance, Guard, Waiver, Decision, Learning, or Level 6 state.
- validate and complete are prohibited for this Run (they would create Evidence-bound completion and ship the backlog).

## Resolved procedures
- `resumable-agent-work` from `continuity-core@0.1.0-vs001` via `.claude/skills/continuity-resumable-work/SKILL.md`
- `nestfolio-backlog-and-evidence` from `nestfolio-binding@0.1.0-vs001` via `.claude/skills/continuity-nestfolio-binding/SKILL.md`

## Applicable Guards
- Explicitly none

## Accepted Decisions

## Exact next action
Replay effect key mi005-material-effect to prove deduplication, then capture the final Checkpoint and close run-mi005 at Level 5 operational scope only (do NOT run validate or complete).

Use only canonical artifacts and this adapter-produced view. Do not reconstruct state from an earlier chat.

