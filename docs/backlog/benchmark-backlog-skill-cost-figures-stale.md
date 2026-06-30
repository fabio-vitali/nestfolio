---
id: benchmark-backlog-skill-cost-figures-stale
status: parking
type: tooling
notes: "benchmark-backlog/SKILL.md cost gate hardcodes '6 bne scenarios' but the live corpus has 35 bne / 53 total — understates the spend ~6× (real 1×≈90M, 3×≈270M tokens). Derive the count dynamically. Captured under bef-deterministic-coverage-gaps for unified PR context; un-pointed back to a standalone parking orphan at that epic's close (2026-06-30) — confirmed orthogonal doc-drift nit by the captured audit (matches the 2026-06-29 backlog-themes adjudication)."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: [project_backlog_eval_framework.md]
validation_gate: null
---

# benchmark-backlog/SKILL.md cost figures are stale

Surfaced while running [[backlog-eval-framework-baseline-run]] (the live baseline).

`benchmark-backlog/SKILL.md` hardcodes the corpus shape at an old size:

- **`SKILL.md:56`** (cost-conscious gate): *"each `backlog-next-epic` scenario (`bne-*`) is ≈1.7–3M
  tokens/iteration and there are **6 scenarios × 3 iterations** by default — order tens of millions
  of tokens total."*
- **`SKILL.md:52`** repeats the "6 scenarios" framing in the gate's question text.
- **`SKILL.md:47`** carries a frozen `"Today: …"` example scenario-id list that is also drifting
  from the live corpus.

Measured reality (2026-06-26, `ls scenarios/*.scenario.mjs`): **53 scenarios, 35 of them `bne-*`** —
not 6. So a full pass is **1× ≈ 90M / 3× ≈ 270M tokens** (price-weighted ≈ $220 / $670 *normalized*,
not a Max bill), grounded in the committed `baseline.json` exemplars (bne scenarios 1.67M–3.04M each,
~90–95% cache-reads of skill prose). The gate as written understates the real spend by ~6×, which is
the one place a stale number does real harm — it's the user-facing cost confirmation.

**Fix:** recompute the gate's token figures from the real corpus, and **derive the `bne-*` count
dynamically** (`ls scenarios/bne-*.scenario.mjs | wc -l`) rather than hardcoding it, so the gate
can't drift again as the corpus grows. Drop or auto-generate the `"Today: …"` id list.

**Why captured (not core):** orthogonal to `backlog-eval-corpus-hardening`'s `done_when` (committed
baseline + deterministic gating + finishing stub) — it's a skill-doc-accuracy fix, not corpus
hardening. Rides along with the eval-framework theme; the captured audit at epic close re-tests it.
