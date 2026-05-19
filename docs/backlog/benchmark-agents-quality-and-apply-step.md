---
id: benchmark-agents-quality-and-apply-step
status: shipped
type: tooling
notes: "Enrich /benchmark-agents cross-task report with current/recommended TEXTS-QUALITY columns + add a final AskUserQuestion step that proposes applying the recommended modelId edits."
references:
  - .claude/skills/benchmark-agents/SKILL.md
out_of_scope:
  - "Re-running the 2026-05-19 sweep — user will rerun /benchmark-agents after this ships."
  - "Editing the existing benchmarks/_summary/2026-05-19T21-15-00Z/cross-task-report.md — explicitly off-limits per user instruction."
  - "Automatic config edits without explicit user confirmation — the apply step MUST go through AskUserQuestion."
spec: null
plan: null
topic_memory: []
validation_gate: "User reruns `/benchmark-agents` and the regenerated `cross-task-report.md` (a) carries `current quality` + `recommended quality` columns in the §1 snapshot table, (b) carries a per-task side-by-side qualitative block (item 2 of §6), and (c) the skill prompts via AskUserQuestion to apply / partially apply / skip the recommended `modelId` edits, gated on `notDegradedRate ≥ 0.7` and absence of iteration-noise flags."
closed: "2026-05-20"
---

# benchmark-agents — quality columns + apply step

## Background

The 2026-05-19 sweep (`benchmarks/_summary/2026-05-19T21-15-00Z/cross-task-report.md`) carries only a one-word `quality verdict` column ("downgrade") in the §1 snapshot. Per-task `evaluation.md` files already contain rich Opus-judged semantic comparisons (see surviving `benchmarks/tasks/market-research/.../evaluation.md` §Per-model — signal counts, outlook length, coverage gaps), but that detail does not propagate to the cross-task summary.

Separately, the skill explicitly forbids editing `*.config.ts` (`SKILL.md` line 139) — so applying the recommendations is a separate manual PR. User asked whether the apply step can be folded into the skill's final phase.

## Scope

Three changes to `.claude/skills/benchmark-agents/SKILL.md`:

1. **§1 snapshot table** — add two columns: `current quality` and `recommended quality` (1-line semantic notes drawn from per-task `evaluation.md` §3 Per-model).
2. **§1.5 side-by-side quality matrix** — per task, two short blocks contrasting current vs recommended on semantic dimensions. The existing market-research §7.5 is the shape to generalise.
3. **§9 Propose config edits** — new final phase. Uses `AskUserQuestion` widget to offer **apply all / apply selected / skip**. Gates:
   - Skip any row where `notDegradedRate < 0.7`.
   - Flag rows triggered by the §6.3 iteration-noise caveat — user must explicitly opt-in to apply those.
   - portfolio-construction is a builder function — the edit target is the `modelId` literal inside `buildPortfolioConstructionConfig` (single edit applies to all 3 OperatingModes).

## Out of scope

- Re-running the 2026-05-19 sweep — user will rerun.
- Touching the existing `cross-task-report.md`.
- Auto-applying without `AskUserQuestion` confirmation.

## Validation

User reruns `/benchmark-agents` after ship; new report has both quality columns + side-by-side blocks, and the apply step fires.
