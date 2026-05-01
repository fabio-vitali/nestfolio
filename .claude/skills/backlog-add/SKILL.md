---
name: backlog-add
description: Append a one-liner to the PARKING LOT section of docs/BACKLOG.md. Use when a side-finding, out-of-scope bug, or future improvement surfaces during execution and should be filed without pivoting from the active workstream.
---

## When this skill applies

Invoke this skill when:
- An out-of-scope failure surfaces during validation of an active spec/plan
- The user says something like "park this", "file this for later", "add to backlog"
- A side-finding deserves to be tracked but doesn't justify pivoting from the active workstream

Do NOT invoke when:
- The finding actually blocks the active workstream's done-definition (then it IS in scope)
- The user is asking to start a new workstream (use the brainstorming or writing-plans skills instead, then update BACKLOG ACTIVE)

## What this skill does

Appends a one-line bullet to the PARKING LOT section of `docs/BACKLOG.md`. Each entry should be:
- A short, grep-friendly description (~80-150 chars on the lead line)
- Optionally followed by 1-2 sub-bullets with concrete evidence (file:line refs, hypothesis, cheapest next step)
- A pointer to a topic memory file if one exists

## Procedure

1. Read `docs/BACKLOG.md` to confirm the file exists and find the PARKING LOT section header.
2. If args were provided to the skill invocation, treat that as the description text. Otherwise ask the user briefly: "What's the one-liner? (and any file:line evidence)".
3. Use the Edit tool to insert a new bullet at the END of PARKING LOT (just before the `---` that follows the section). Preserve existing entries.
4. Do NOT commit. The backlog is project-scoped (the user will commit at their cadence). Just leave the working-tree change.
5. Report back in one line: "Filed in PARKING LOT: <description>. Resuming active workstream."

## Format template

```markdown
- **<one-line topic title>** — <evidence or context, file:line refs welcome>. Topic memory: `project_<topic>.md` (if exists).
```

If the item is later promoted to QUEUED, the editor (you, or the user) can copy it up and expand into the full QUEUED format (Done when / Status / Concrete failures / Topic memory).

## Examples of good PARKING LOT entries

```markdown
- **`OnboardingRepository.updatePhase` ValidationException on non-mandate commits** — latent backend bug; non-blocking for onboarding e2e per Spec 3 ship.
- **BFF resolver region sweep** — advisory-bff + ledger-bff mutation resolvers likely missing `region` field.
- **Hoist named-tool retry to `libs/agent-orchestrator`** — only if advisory agents start showing the same Sonnet flakiness; not seen yet.
```

## Examples of BAD entries (avoid)

```markdown
- TODO: investigate something
- Fix the bug we saw earlier
- Need to look at the dashboard
```

These have no evidence, no path to action, and rot. If you can't be specific, ask one clarifying question before filing.
