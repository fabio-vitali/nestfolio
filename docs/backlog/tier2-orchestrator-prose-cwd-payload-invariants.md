---
id: tier2-orchestrator-prose-cwd-payload-invariants
status: parking
type: tooling
notes: "Tier-2 /backlog-next-epic prose leaves 3 cwd/payload-format invariants implicit (verbatim-fenced payload relay; worktree-not-main roster+postflight cwd; HEAD-relative checks from worktree). Surfaced + worked around in the first live --auto dry-run."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
epic: tier2-epic-orchestrator-hardening
epic_role: core
---

# Tier-2 orchestrator prose: make the cwd / payload-format invariants explicit

Surfaced during the first live `/backlog-next-epic --auto` dry-run
(`tier2-live-end-to-end-dry-run`, shipped 2026-06-23). All three were worked around
live — the Tier-2 mechanism itself is sound; this is **prose hardening**, low severity.
Full evidence: `docs/superpowers/spikes/2026-06-23-tier2-harness-spike.md`
§"Findings / operator notes".

1. **Verbatim-fenced payload relay.** `backlog-next-epic` E4 step 3 says "write the
   received message text to a temp file" before `member-summary.mjs parse`. The parser
   (`fencedKindBlocks`) only matches ` ```json … ``` ` fenced blocks, so relaying a
   reformatted/bare-JSON payload yields a spurious exit-3 `no kind-bearing json payload
   found` (reads like a parse-failure that isn't one). Fix: prose should say "write the
   received message text **verbatim, fence included**."

2. **Worktree-not-`main` cwd for roster + member postflight.** A member ships
   `status: shipped` on the epic branch (in the worktree); on `main` it is still
   `parking`/`active`. `epic-members.mjs` and the `--lane=epic-member` postflight read
   frontmatter from cwd — run from `main`/`$MAIN` they see stale state (the loop re-picks
   the just-shipped member; the postflight false-fails). The `/backlog-next` Step-7
   `$MAIN`-cwd pattern is **Complex-lane** (worktree removed pre-postflight); in
   **epic-member mode the worktree is alive and IS the source of truth**, so both must run
   with cwd in the worktree. E4 step 1/6 + the epic-member-mode Step-7 note should say so.

3. **HEAD-relative checks from the worktree.** `runstate.mjs e2e-fresh` (and any
   HEAD-relative gate) resolves `HEAD` from cwd, so E6/E7 freshness checks must run from
   the worktree, else `e2e.sha` is compared against `main`'s tip.

## Cheapest next step

A prose-only pass over `.claude/skills/backlog-next-epic/SKILL.md` (E4 step 3, E4 step 1/6,
E6/E7) + the `/backlog-next` epic-member-mode deltas. Shares a root cause with the (shipped)
`orchestrator-worker-seam-prose` cluster — re-cluster here if a future Tier-2-prose theme epic
is minted by `/backlog-themes`.
