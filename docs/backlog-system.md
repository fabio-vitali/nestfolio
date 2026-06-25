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

### `/benchmark-backlog <mode> [refs] [flags]`

Test the backlog skills themselves — see below. Use when you change a skill.

---

## Testing the backlog skills (the evaluation framework)

The skills are large and encode many hard-won lessons, so changing one can silently regress
behavior. The framework at `scripts/benchmark-backlog/` runs a real skill against a sandboxed repo
(stubbed `gh` / `nx` / deploy) and grades the result — 52 scenarios in all.

Each run yields one pass/fail from four checks: clean exit, expected file changes, backlog still
valid, and an LLM-judge score on the run's judgement calls. The deterministic unit suites run
alongside, so one invocation reports overall health.

### Usage

```bash
/benchmark-backlog <mode> [refs] [flags]
# under the hood:
node scripts/benchmark-backlog/run.mjs <mode> [refs] [flags]
```

| Mode | |
|---|---|
| `regression` | Run on current HEAD; flag anything below the committed baseline. |
| `compare <before> <after>` | Interleaved A/B over two refs to prove a change helps or doesn't regress. |
| `rebaseline` | Overwrite the committed baseline. The only mode that writes. |

| Flag | Default | |
|---|---|---|
| `--skill=<name>` | all | One family: `backlog-add` · `backlog-next` · `backlog-next-epic` · `backlog-themes`. |
| `--scenario=id1,id2` | all | Only these scenario ids. |
| `--iterations=N` | `3` | Runs per scenario. |
| `--model=<id>` | `claude-opus-4-8` | Model the skills run under. |

### Examples

```bash
/benchmark-backlog regression                                      # regressions vs baseline
/benchmark-backlog compare main HEAD                               # A/B the branch against main
/benchmark-backlog compare main HEAD --scenario=add-fold-captured  # single-scenario check
/benchmark-backlog regression --skill=backlog-add --iterations=1   # narrow spot-check
/benchmark-backlog rebaseline                                      # save a new baseline (writes)
```

The baseline tracks both quality and cost (tokens), so a quality-neutral but pricier change still
trips it. A full run costs millions of tokens — the skill confirms before a full sweep and never
runs on its own; narrow with `--skill` / `--scenario` / `--iterations=1` to spot-check first.

---

## Where to go next

- **The rules:** `CLAUDE.md` § "Backlog Discipline" (invariants, epics, lanes).
- **Skill internals:** the `SKILL.md` in each `.claude/skills/backlog-*/` folder.
- **Eval framework design:** `docs/superpowers/specs/2026-06-24-backlog-eval-framework-design.md`.
- **Companion guide:** `docs/agent-system.md` — the docs-and-skills system this sits beside.
