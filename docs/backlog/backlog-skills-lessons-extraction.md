---
id: backlog-skills-lessons-extraction
status: parking
type: refactor
notes: "β pass: extract F-story backstory from procedural backlog SKILL.md into a LESSONS/pitfalls log; keep one-line guardrails inline; de-duplicate. Doc-restructuring only, no behavior change."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
epic: backlog-skills-simplification
epic_role: core
---

# Backlog skills: extract lessons/backstory from procedures (β)

**The cut.** In each backlog SKILL.md, the imperative steps are interleaved with multi-sentence
**F-number backstory** explaining *why* a non-obvious thing must be done a certain way (e.g. the
paragraph-long F-33 saga of why `ExitWorktree` can't be used in a cwd-pinned session). Separate the
two:

- **Keep inline** the terse, load-bearing **guardrail** at the exact step that needs it — e.g.
  "use git cleanup, NOT `ExitWorktree`". The agent reading the procedure must see the warning at the
  moment of action, or the bug regresses.
- **Relocate** the explanatory *backstory* (the F-story essay, the "this is why it fails" prose) into
  a dedicated per-skill or shared `LESSONS.md` / pitfalls log that the procedure *links* to.
- **De-duplicate** lessons re-narrated across multiple SKILL.md files into one canonical entry.

**Constraints.**
- **No behavior change** — this is doc-restructuring only. No helper/code edits, no lint-rule edits.
- **No knowledge loss** — every F-lesson is moved, never deleted. The LESSONS log is the new home,
  cross-referenced by F-number so the PR-review trail stays intact.

**Risk.** Near-zero — the main hazard is moving a guardrail that needed to stay inline. Mitigation:
the inline-guardrail / relocated-backstory split above; review each move against "would the agent at
this step still be warned?"

**Cheapest next step.** Inventory the `F-[0-9]+` mentions across the five SKILL.md files (the
complexity audit found ~19 distinct ones, highest ~F-33), tag each as guardrail-vs-backstory, draft
the LESSONS log structure.
