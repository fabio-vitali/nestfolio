# Make the backlog-lint library total + located, and unify the frontmatter parsers

**Date:** 2026-06-22
**Backlog item:** `lint-library-total-and-located` (core member #1 of `backlog-skills-hardening`, worked standalone as a bootstrap fix)
**Audit source:** `docs/reviews/2026-06-22-backlog-skills-audit.md` § Cluster 1 (F-15, F-16-read, F-18, F-19, F-20, + backlog-add non-string write-side)

## Problem

The backlog-lint library crashes opaquely on YAML the backlog skills themselves can legally write, and there are **four** independent frontmatter parsers that can disagree with each other. Two crash classes, one drift class:

1. **Non-total render.** `lib/index-render.mjs` calls `.trim()` on `notes` / `done_when` guarded only by `?.` (null, not non-string). A `notes:`/`done_when:`/`scope:` written as a YAML list or number — e.g. a `backlog-add` one-liner starting with `-` or `:` — throws `TypeError: …trim is not a function` **with no filename**. The crash lands inside `renderIndex`, which `lint.mjs` calls at the `--fix` **write** (line 33) *before* the rules loop (lines 39–52) — so it corrupts/staleness the index before any violation can report.
2. **Unlocated parse error.** A duplicate frontmatter key (e.g. the ship steps shipping `validation_gate: null` then adding a second `validation_gate:`) makes `parseYaml` throw `YAMLParseError: Map keys must be unique` — raw, **with no filename** — from `loadBacklogFiles` (line 30), killing the entire lint run.
3. **Parser drift.** `epic-members.mjs` carries a 4th hand-rolled regex parser (`/^([a-z_]+):\s*(.*)$/i`) that keeps inline comments (`epic_role: captured # rides along` → member vanishes from *both* rosters; `status: active # WIP` → in-flight core treated terminal → `isDrainable()` wrongly true) and turns `rank: null` into `NaN`.

## Pipeline facts (verified against code, 2026-06-22)

- `lint.mjs:30` `loadBacklogFiles(BACKLOG_DIR)` — crash point #2 (parse error, no filename).
- `lint.mjs:33` `writeFileSync(BACKLOG_INDEX, renderIndex(files))` runs under `--fix` **before** the per-file rules loop — crash point #1 (non-string `.trim()`).
- `rules.mjs` is **already total**: `v = (rule, file, message) => ({ rule, file: file?.filename ?? null, message })` carries the filename; string-typed rules (`ruleShippedValidationGate`, `ruleActiveEpicFields`) guard `typeof === 'string'`; `rulePromotionTriggerGated` coerces via template literal. No `.trim()`-on-non-string crash exists in rules.
- `dossier-sync.mjs:9-14` already demonstrates the guard to mirror: `try { parseFrontmatter(content) } catch (e) { console.warn(\`skipping ${path}: malformed YAML (${e.message.split('\n')[0]})\`); return; }`.
- `index-render.mjs` non-string `.trim()` sites: `lineFor` (`notes`), `renderEpicBlock` (`notes`, `done_when`). Section filters all key on `f.frontmatter?.status`, so a null-frontmatter file is **already auto-excluded** from every section and never reaches `lineFor`.

## Design

### 1. Total load boundary — `lib/frontmatter.mjs`

`parseFrontmatter(content)` keeps throwing (single responsibility: parse or throw). `loadBacklogFiles(dir)` becomes the **total** boundary by wrapping the per-file parse in try/catch (mirroring `dossier-sync.mjs`):

```js
export function loadBacklogFiles(dir) {
  return readdirSync(dir)
    .filter(f => f.endsWith('.md') && f !== 'README.md')
    .map(f => {
      const path = join(dir, f);
      const content = readFileSync(path, 'utf8');
      const id = f.replace(/\.md$/, '');
      try {
        const { frontmatter, body } = parseFrontmatter(content);
        return { filename: f, id, path, frontmatter, body, parseError: null };
      } catch (e) {
        return { filename: f, id, path, frontmatter: null, body: content,
                 parseError: e.message.split('\n')[0] };
      }
    });
}
```

Every record gains `parseError: string | null`. `lint.mjs:30` can never throw again.

### 2. Located parse violation — `lib/rules.mjs` + `lint.mjs`

New rule function, slotted into the per-file loop:

```js
export function ruleFrontmatterParseable(file) {
  if (file.parseError) {
    return [v('frontmatter-parseable', file,
      `${file.filename}: malformed YAML frontmatter — ${file.parseError}`)];
  }
  return [];
}
```

Wired in `lint.mjs` alongside the other per-file rules. This is a **structural precondition gate, not a 12th numbered rule** — the CLAUDE.md "11 rules" canon and the `✓ … all 11 rules pass` success line are preserved (the gate is silent when every file parses). The other rules already `?.`-guard null frontmatter, so they pass the broken file silently while the gate reports it located; the run exits 1.

### 3. Total render — `lib/index-render.mjs`

Add a coercion helper and route the three frontmatter `.trim()` sites through it:

```js
const str = (x) => (typeof x === 'string' ? x : x == null ? '' : String(x));
```

- `lineFor`: `const notes = str(f.frontmatter.notes).trim() ? ` — ${str(f.frontmatter.notes).trim()}` : '';` and `str(f.frontmatter.type)`.
- `renderEpicBlock`: `str(epic.frontmatter?.notes).trim()`, `str(epic.frontmatter?.done_when).trim()`.

No null-frontmatter handling needed in render — parse-failed files are auto-excluded by the status filters (see Pipeline facts). `renderIndex` becomes total, so `lint.mjs:33` (`--fix` write) never crashes mid-write.

### 4. Unify epic-members onto the canonical parser — `epic-members.mjs`

(Decision: **Option A — import the canonical `loadBacklogFiles`**; one canonical reader, drift structurally impossible.)

- Delete the local regex `parseFrontmatter` (current lines ~27–49).
- `import { loadBacklogFiles } from '../backlog-lint/lib/frontmatter.mjs';`
- In `main()`, build records from the canonical loader:
  ```js
  const records = loadBacklogFiles(dir).map(f => ({ id: f.id, fm: f.frontmatter ?? {} }));
  ```
  (`loadBacklogFiles` is now total, so a malformed file yields `fm: {}` and simply fails to match epic filters — acceptable for the resolver; the orchestrator runs `lint` first, which reports it located.)
- Fix the rank coercion in `coreMembers` so `rank: null` and yaml-native numbers both behave:
  ```js
  rank: r.fm.rank != null ? Number(r.fm.rank) : undefined,
  ```

With the real `yaml` parser, `epic_role`/`status` carry no inline-comment tails and `rank` is a real number — the three drift bugs vanish structurally, not by coincidence.

### 5. Write-side guard — `backlog-add` (defense-in-depth)

Verify `backlog-add`'s frontmatter writer emits `notes:` (and other free-text scalars) via `yaml.stringify` (which auto-quotes values that would otherwise parse as a list/number). If it hand-rolls the frontmatter string, route the value through `yaml.stringify`. The read-side total render (§3) is the primary fix; this prevents the malformed write at the source. Confirm actual behavior during execution — likely already safe.

### 6. Regression tests (one per failure mode, into existing suites)

| Suite | Case |
|---|---|
| `backlog-lint/test/frontmatter.test.mjs` | A fixture with a **duplicate** `validation_gate:` key → `loadBacklogFiles` returns a record with `parseError` set + `frontmatter: null`, **does not throw**. A non-string `notes:` (YAML list) → parses to an array, no throw. |
| `backlog-lint/test/rules.test.mjs` | `ruleFrontmatterParseable` → one `frontmatter-parseable` violation **naming the file** when `parseError` is set; `[]` when clean. |
| `backlog-lint/test/index-render.test.mjs` | `renderIndex` over in-memory records where `notes`/`done_when` is a number/list → **does not throw** (str() coerces); a null-frontmatter record is excluded gracefully. Hermetic (in-memory records, no git shell-out). |
| `backlog-next-epic/test/epic-members.test.mjs` | Records built via the **real** `loadBacklogFiles` from a fixture containing `epic_role: captured # comment`, `status: active # WIP`, and `rank: null` → correct core/captured rosters + correct `selectNextMember`/`isDrainable` (proves drift is gone). Remove/repoint the now-deleted local-parser unit tests. |

Test invocation uses the glob form (`node --test '<dir>/*.test.mjs'`) — the bare-directory form is a separate Node-24 issue owned by `backlog-skills-misc-polish`.

## Out of scope

- The two `detect-*` readers (`detect-deploy-needed.mjs`, `detect-doc-derivation.mjs`) — the 3rd/4th forks, but homed in the `deploy-tooling-integrity` epic (F-1, F-2/F-3). This member unifies only `epic-members.mjs`.
- `lint --fix` performance (F-29: ~25 s, per-shipped-file `git log` fan-out) — `backlog-skills-misc-polish`.
- Non-hermetic existing render-test git shell-out (F-31) — `backlog-skills-misc-polish`. New tests added here are hermetic.
- `--auto` decision discipline, merge ownership, run-state, ship/merge mechanics — separate `backlog-skills-hardening` core members.
- The backlog data-model redesign itself (`backlog-redesign`).

## Done when

`lint.mjs --fix` never throws on any frontmatter a skill can legally write; a malformed file yields a located `frontmatter-parseable` violation naming the file; `epic-members.mjs` parses identically to the lint gate (inline comments + `rank: null` handled); a regression test covers each case.
