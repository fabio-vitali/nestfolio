---
id: tier2-live-end-to-end-dry-run
status: shipped
closed: 2026-06-23
type: tooling
notes: "Live end-to-end validation of the Tier-2 /backlog-next-epic subagent dispatch shipped in backlog-next-epic-member-subagent-isolation. The new orchestrator/worker skills are the ACTIVE skills now that PR #23 has merged (merge commit f945ac19), and /backlog-next-epic is disable-model-invocation (user-triggered) + needs CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1, so the full dry-run could not run from the pre-merge implementation session (helper-level path coverage was 13/13 green + the harness spike proved the primitives). PROMOTED 2026-06-23: trigger fired — PR #23 merged, Tier-2 skills now live on main, so the live dry-run is runnable."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: "Live /backlog-next-epic --auto dry-run executed end-to-end on throwaway epic tier2-dryrun-throwaway (2 doc-layer core members) through the Tier-2 epic-member-worker subagent seam (dispatch → SendMessage MEMBER-SUMMARY → member-summary.mjs parse exit-1 → ship). 4/4 observable paths PASS: (1) no member file-dumps — only compact fenced summaries reached the orchestrator; (2) context-isolation proxy — file-heavy member-b (read 5 files in-worker) ≈ trivial member-a orchestrator-context delta; (3) §G wx-lock — second wx acquire threw EEXIST → refuse-and-ask; (4) single-branch/never-self-merge — 8 [member-id]-prefixed commits on one feat/epic branch, --auto STOPPED at E8 AskUserQuestion. 5 adversarial paths cross-referenced to deterministic helper harness 13/13. 3 operator findings recorded (fence-preserving payload relay; worktree-not-main roster/postflight cwd; HEAD-relative checks from worktree). Results + teardown in docs/superpowers/spikes/2026-06-23-tier2-harness-spike.md §'Live run #1'. Throwaway epic fully torn down. Commits cd373c9b (scaffold) → 63594760 (teardown). Counts as 1 of 3 Tier-2 epics gating remove-tier1-clear-fallback."
---

# Tier-2 live end-to-end `/backlog-next-epic` dry-run (post-merge)

The deterministic layer is already covered (member-summary/fork-key/runstate unit suites + a 13/13 helper-level path-coverage harness + the `2026-06-23-tier2-harness-spike.md` primitives). This item is the **live** layer that can only run once the Tier-2 skills are active on `main`.

## Runbook

1. On `main` (Tier-2 skills active), create a throwaway **2-core-member doc-layer theme epic** (two trivial doc-layer members under one `type: epic`).
2. Ensure `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` is set.
3. Run `/backlog-next-epic <throwaway-epic-id> --auto`.
4. Assert each path from `2026-06-23-tier2-harness-spike.md` §"Dry-run path coverage (B)":
   - happy path — orchestrator transcript shows only one-line progress notes + the decision log, **no member file-dumps**;
   - crash/resume mid-fork — interrupt after a ruling is persisted; resume does **not** re-ask the resolved fork;
   - override — the E6.0 audit re-opens a member with an imposed value the worker **ADOPTS**; the `supersedes` entry is not deduped away;
   - blocked — a `status: blocked` member is routed via **AskUserQuestion** (`abort-epic`/`file-follow-up-and-skip`/`split-and-retry`), not a prose halt;
   - parse-failure — a malformed payload triggers ≤2 repair turns then a floor;
   - inferred too-large — repeated exit-3 → `split-and-retry`, not a generic floor;
   - multi-fork interactive member is **not** force-floored;
   - concurrency — a second `/backlog-next-epic <id>` while the `wx` lock is held → refuse-and-ask.
5. Measure the **context-isolation proxy**: the orchestrator's per-member context delta (turn-count + payload bytes) is bounded and **independent of files-touched** (trivial vs file-heavy member), scaling only as #forks × fixed payload.
6. Tear down the throwaway epic. Record results back in `2026-06-23-tier2-harness-spike.md`.

Counts toward the "3 successful Tier-2 epics" gate for `remove-tier1-clear-fallback`.
