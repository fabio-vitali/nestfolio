# runtime — the Long-Horizon Engineering Runtime (ring-1 core)

The single library of **checks** — every consistency property the project asserts — with provenance, a
floor-curated lifecycle, and a self-check. This is **SPEC 1**: the project- and harness-agnostic ring-1
engine. SPEC 2 (the backward edge) and SPEC 3 (the forward edge + capability seams) consume its schema
verbatim.

> Design: `docs/superpowers/specs/2026-07-01-runtime-spec-1-check-registry-and-atom.md` ·
> Vision: `docs/vision/long-horizon-engineering-runtime.md`

## The ring model

- **Ring 1 — `engine/`** (this spec): pure, project- & harness-agnostic. Depends outward on **nothing**.
  Three zod schemas + six typed helpers + their golden-gate tests.
- **Ring 2 — the harness seam** (SPEC 3): binds ring-1 to a host (Claude Code, CI, …). Not built here.
- **Ring 3 — `content/`**: the *project's* check library (Nestfolio's checks are the first content
  ring, quarantined behind seam #2). Swap `runtime.config.json.checksDir` at another repo and ring-1 is
  unchanged.

The **only** project binding is `runtime.config.json` (`{ checksDir, exclusionsRoot }`), deliberately a
sibling of `engine/` — never a file inside ring 1.

## Layout

```
runtime/
  runtime.config.json     # the only project binding (checksDir / exclusionsRoot)
  package.json            # { "type": "module" } — scopes the subtree to ESM
  tsconfig.json           # typecheck-only (.ts contract gate: noEmit + allowImportingTsExtensions + strict)
  project.json            # nx project "runtime": `test` + `typecheck` (run-commands, forwardAllArgs:false)
  engine/                 # RING 1 — pure
    schema/               # check.schema.ts · item.schema.ts · finding.schema.ts  (zod + z.infer types)
    lib/                  # the six helpers + fs-walk / glob-overlap / errors utilities
    test/                 # node:test golden gates (§13 A–F) + schema/glob/content-ring suites
  content/checks/*.yaml   # RING 3 — Nestfolio's first check library (proof slice)
  eval/scenarios/*.mjs    # judgment-check eval scenarios (SPEC 2 authors; stubbed here)
```

## The six helpers (`engine/lib/`)

| Helper | Contract |
|---|---|
| `loadRegistry({checksDir})` | `→ { checks, byId, errors }` — parse + zod-validate every `*.yaml`; malformed/duplicate/invalid entries are **located** in `errors[]`, never crash. |
| `resolveEvaluator({check})` | `→ { kind, invoke }` — dispatch `evaluator.run` over the closed scheme set `cmd`/`module`/`eslint`/`skill`; throws `EvaluatorUnresolved` / `JudgmentContractMissing`. |
| `runCheck({check, context})` | `→ { findings, ran, skippedReason? }` — enforce the honesty rule (a check never runs in a context it did not declare), tag findings with `check.kind`. |
| `findByScope({registry, scope})` | `→ { checks, invariants }` — retrieval-scoped `checks` (by a pure glob-overlap predicate) + **all** global invariants, always. |
| `advanceLifecycle({check, transition, floorApproval, successor})` | `→ { check, event }` — the floor-gated state machine; every transition requires `floorApproval` (checked **first**). |
| `metaCheck({registry, env})` | `→ Finding[]` — the registry self-check: 3 integrity assertions + 2 rot-detectors + cheap-by-construction, over an injected `env`. Files findings; never advances state. |

## Run the gates

```bash
# All golden gates (must use the glob form — bare `node --test <dir>` does not discover on Node 24):
node --test runtime/engine/test/*.test.mjs

# Or via nx:
pnpm nx test runtime        # the node:test suites
pnpm nx typecheck runtime   # tsc --noEmit: proves the frozen .ts contract compiles under `strict`
```

**Runtime requirement:** Node ≥24 (native `.ts` type-stripping — zero build step). zod v3, `yaml` v2.
No external service; the whole engine is git-native files + small tested helpers.
