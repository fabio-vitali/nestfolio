# Severity / impact rubric (read-time scoring guide)

Used to make "impact" consistent across `/backlog-next-epic` selection runs. **Consulted at
selection time only — never written into frontmatter.** Four ordinal levels (impact *if left
undone*):

- **critical** — data loss / silent prod leak / real-money correctness / blocks all e2e.
- **high** — broken flow with no workaround / latent crash on a common path / blocks a domain's e2e.
- **medium** — degraded UX or correctness with a workaround / single-service latent bug.
- **low** — cosmetic / cleanup / docs drift / speculative hardening.

## Scoring an epic

An epic's impact is the **aggregate blast-radius of its theme** — the judgment `/backlog-themes`
already makes when it prints a cluster's blast radius. Weigh, in order:

1. The worst-level finding the epic's `scope:` / `done_when:` / member notes describe (an epic that
   contains a `critical` member is at least `high` at the epic level).
2. **Breadth** — how many services / domains / consumers the theme touches (more breadth raises it).
3. **Open core-member count** (`core=open/total` from `--candidates`) — a larger amount of unfinished
   load-bearing work raises urgency; a nearly-drained epic is lower.

Ties break toward the more **reusable / cross-cutting** theme (project rule: reusability breaks ties).
Output a single level per epic plus a one-line reason; this drives the menu order, not a stored value.
