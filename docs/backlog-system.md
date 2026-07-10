# Backlog System — Developer Guide

The backlog is a folder of one-file-per-task records plus a generated index. A handful of slash
commands operate it: pick the next task, file a new one, keep it healthy, and test the commands
themselves.

Authoritative rules live in `CLAUDE.md` § "Backlog Discipline"; this is the practical overview and
command reference. If the two disagree, `CLAUDE.md` wins.

---

## How it's stored

- **`docs/backlog/<id>.md`** — one record per task; the filename is the `id` everything references.
- **`docs/BACKLOG.md`** — generated index, rebuilt by `/backlog-lint`. Don't hand-edit it.

`status` field:

| `status` | |
|---|---|
| `active` | in progress — exactly one at a time |
| `queued` | committed next; ordered by `rank` |
| `parking` | deferred until a trigger fires (the parking lot) |
| `shipped` / `dropped` | closed, with a validation note / reason |

**Epics** group related tasks. A *delivery epic* is worked actively — its tasks land on one branch
and ship as one PR (one at a time). A *theme epic* is a labelled bucket in the parking lot. Within
an epic a task is **core** (epic isn't done without it) or **captured** (done alongside, but not
required for closure); when in doubt, core.

Two system-specific constraints: one `active` task at a time — file side-findings with `/backlog-add`
rather than switching — and `docs/BACKLOG.md` is generated, never hand-edited.

---

## Command reference

### `/backlog-next [<id>]`

Run the next task end to end: pick it, work it in the right place, close it out (rebuild docs →
deploy → test → merge).

| Argument | Effect |
|---|---|
| *(none)* | Resume the `active` task, else start the top-ranked `queued` one. |
| `<id>` | Start that task instead of the ranked pick. |

```bash
/backlog-next
/backlog-next advisory-bff-cycle-status-projection
```

### `/backlog-next-epic [<epic-id>] [--auto] [--like "<criteria>"]`

Run a delivery epic as one branch and one PR: each core task, the heavy end-to-end tests once at the
end, shipped together.

| Argument | Effect |
|---|---|
| *(none)* | Selects the highest-impact open epic, then confirms. |
| `<epic-id>` | Run that epic. |
| `<free text>` | Treated as selection criteria (e.g. `fix worst bug`), then confirmed. |
| `--like "<criteria>"` | Rank candidate epics by criteria instead of by impact. |
| `--auto` | Hands-off: auto-decides and logs each choice in the PR, pausing only on risky calls. |

```bash
/backlog-next-epic
/backlog-next-epic bff-read-model-semantic-gaps
/backlog-next-epic bff-read-model-semantic-gaps --auto
/backlog-next-epic --like "anything touching the dashboard"
```

### `/backlog-add [<description>]`

File a task without interrupting the current one; it routes the finding (active epic, an existing
bucket, or the parking lot) and rebuilds the index.

| Argument | Effect |
|---|---|
| `<description>` | The finding to file. Omitted → taken from the current context. |

```bash
/backlog-add activity feed is missing the awaiting-confirmation state
/backlog-add park this: noisy deprecation warning on dashboard-bff startup
```

### `/backlog-lint`  ·  CLI: `node .claude/skills/backlog-lint/lint.mjs [--fix]`

Validate every record against the invariants and rebuild the index. Run on every ship and after any
hand-edit.

| Argument | Effect |
|---|---|
| *(none)* | Validate only; report violations. |
| `--fix` | Validate, then rebuild `docs/BACKLOG.md` and the back-links in memory dossiers. |

```bash
/backlog-lint
node .claude/skills/backlog-lint/lint.mjs --fix
```

### `/backlog-themes`

Cluster parking-lot orphans that share a root cause into theme epics. No arguments; run on demand
when the parking lot grows.

```bash
/backlog-themes
```

## Testing the backlog skills

The backlog skills run on the Long-Horizon Engineering Runtime (`runtime/`) — the `run-*.mjs` drivers
own the execute / gate / ship drive, so the skills' behavior is exercised by the runtime's own tests
rather than by headless prose-skill grading:

- **`pnpm nx test runtime`** — the engine/loop/adapter/schema/journal suites (the drive, gates, floors,
  intake routing, orchestrator spine).
- **`runtime/eval/e2e/greenfield.test.mjs`** — the cold-start adoption e2e: init → violation blocked →
  mint at the floor → curate → commit passes, played end-to-end with no LLM.
- **`node --test scripts/backlog-regression/test/*.test.mjs`** — the deterministic backlog-gate
  regression: the runtime commit gate must catch every one of the 11 lint-rule violation classes
  (+ index-matches + element-shape) over per-rule good/bad fixture stores.
- **`node --test .claude/skills/backlog-*/test/*.test.mjs`** — the skills' own helper unit suites
  (preflight/postflight, backlog-gate, epic-members, decision-log, …).

> The legacy headless `/benchmark-backlog` evaluation harness (`scripts/benchmark-backlog/`) and the
> `parity-oracle` A/B comparator were retired with the legacy work-driver (runtime-legacy-retirement,
> 2026-07-09/10): they graded the legacy prose-skill behavior, which the runtime engine + the
> deterministic suites above now own and test.

---

## Where to go next

- **The rules:** `CLAUDE.md` § "Backlog Discipline" (invariants, epics, lanes).
- **Skill internals:** the `SKILL.md` in each `.claude/skills/backlog-*/` folder.
- **Eval framework design:** `docs/superpowers/specs/2026-06-24-backlog-eval-framework-design.md`.
- **Companion guide:** `docs/agent-system.md` — the docs-and-skills system this sits beside.
