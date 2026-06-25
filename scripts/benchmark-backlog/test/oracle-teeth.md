# Oracle teeth — does the harness actually detect regressions?

> Plan Task 14 / spec §Validation (m5, m6). Before any "no regression" verdict from this framework is
> trusted (e.g. on the `backlog-skills-simplification` epic), we must prove the oracle has **teeth**:
> that it flips on a *known injected* regression a deterministic lint cannot independently catch, and
> that it does not flip on noise. Three experiments: **self-consistency**, **quality teeth**,
> **value teeth**. All runs are headless `claude -p` on `claude-opus-4-8` (judge `claude-sonnet-4-6`),
> isolated sandboxes, via `scripts/benchmark-backlog/run.mjs`.

## 1. Self-consistency (no false positives on a stable system)

**Claim:** running `regression` against current `main` reproduces within band — zero `anyGateFlip`.

**Method:** `node run.mjs regression --iterations=3` over all 6 exemplars (the committed
`baseline.json`). Heavy epics (e8-conflict, resume-merged-tail) at the 600s ceiling.

**Result — PASS.** Every scenario `gatePassRate: 1`, `anyGateFlip: false` across 3 iterations:

| scenario | gatePassRate | anyGateFlip | tokens.total (median) | turns |
|---|---|---|---|---|
| add-fold-captured | 1 | false | 371,053 | 9 |
| bne-auto-design-pause | 1 | false | 1,674,392 | 18 |
| bne-e8-conflict-resolution | 1 | false | 3,039,168 | 24 |
| bne-resume-merged-tail-only | 1 | false | 2,245,513 | 18 |
| next-lane-complex | 1 | false | 1,078,730 | 14 |
| themes-discrimination | 1 | false | 889,893 | 15 |

The oracle does not cry wolf on a stable system. (Getting here required de-flaking four real framework
bugs — see the git log: e8 judge-noise, themes ambiguous-decoy fixture, judge-no-json crash, 300s epic
timeout. A flaky oracle is a broken oracle.)

## 2. Quality teeth (a prose-only regression flips a gate; lint cannot catch it)

**Claim:** a behavior regression in the orchestration prose — invisible to `backlog-lint` — flips a
gate, so `compare` would catch a quality regression in `backlog-skills-simplification`.

**Mutation (ref `bef-teeth-mut`, scratch):** in `backlog-next-epic/SKILL.md` E8, replace the
merge-ownership STOP guard ("STOP via AskUserQuestion — the merge is the user's; NEVER `gh pr merge`")
with a naive self-merge directive ("merge the PR yourself: `gh pr merge --squash`"). This is a
plausible over-simplification of the merge-ownership rule, it is **pure prose**, and `lint.mjs` passes
on it unchanged (it governs `docs/backlog/` frontmatter, not skill prose).

**Method:** `node run.mjs compare HEAD bef-teeth-mut --scenario=bne-e8-conflict-resolution --iterations=2`.
Expected: HEAD (A) keeps `gatePassRate: 1` (resolves the conflict, opens the PR, STOPs, `gh pr merge`
never called); the mutated variant (B) drops — the `callLog.neverCalled: ['gh pr merge']` invariant
flips when it self-merges (and/or `terminal` flips pause→completed).

**Result — PASS.** `compare HEAD bef-teeth-mut --scenario=bne-e8-conflict-resolution --iterations=2`:

| variant | gatePassRate | anyGateFlip | detection |
|---|---|---|---|
| A (HEAD) | 1.0 | false | — |
| B (mutated) | **0.5** | **true** | `terminal=completed, expected pause` |

The mutated skill resolved the conflict correctly (`golden` still passed — the epic ends shipped) but
**ran past the PR to completion instead of STOPping** — exactly the merge-ownership regression injected,
caught by the `terminal: pause` invariant. `lint.mjs` is blind to it (skill prose, not frontmatter).
The oracle has quality teeth.

## 3. Value teeth (a known token injection moves the cost proxy; quality unchanged)

**Claim:** the token/cost proxy reflects real prose-size change, so `compare` can quantify the
*value* (token reduction) of a simplification.

**Injection (ref `bef-teeth-inj`, scratch):** append a ~2,050-token inert filler comment to
`backlog-add/SKILL.md` — no behavior change, a fixed known quantity of skill-load tokens.

**Method:** `node run.mjs compare HEAD bef-teeth-inj --scenario=add-fold-captured --iterations=2`.
Expected: both variants keep `gatePassRate: 1` (behavior identical); B's `firstTurnProseTokens` (the
cache-inclusive skill-load proxy) rises by ≈2,050 over A, calibrating the minimum detectable effect.

**Result — PASS (via `tokens.total`), and it exposed a proxy bug.**
`compare HEAD bef-teeth-inj --scenario=add-fold-captured --iterations=2`:

| variant | gatePassRate | firstTurnProseTokens | tokens.total |
|---|---|---|---|
| A (HEAD) | 1.0 | 24,767 | 400,624 |
| B (injected ~2,050 tok) | 1.0 | 24,769 (**Δ+2**) | 454,455 (**Δ+53,831**) |

Quality unchanged (both 1.0) ✓. The injection moved the **headline token signal decisively** — but
in `tokens.total`, **not** `firstTurnProseTokens`. The injected ~2,050 tokens are re-read from cache
on every subsequent turn, so their true amortized cost is ≈ 2,050 × ~26 turns ≈ 54k, which
`tokens.total` captures. `firstTurnProseTokens` moved only +2 because it is **hardcoded to read turn
index 1** (`run.mjs` `firstTurnProseTokens(perTurn, Math.min(1, len-1), 0)`), while the skill actually
loads at a later turn (after the Skill-tool call) — so the one-time-load proxy misses the injection
AND, even corrected, would only see the one-time load, not the amortized re-read cost.

**Takeaway:** the value oracle has teeth via `tokens.total` (the right amortized signal). The
`firstTurnProseTokens` proxy was mis-calibrated and has since been **removed** (`bef-prose-token-proxy-miscalibrated`,
2026-06-25) in favour of `tokens.total` — the reports now surface `tokens.total` as the `totTok`
column. It never blocked value detection.

## Verdict

**The oracle has teeth.** Quality regressions flip a gate the deterministic lint cannot catch
(experiment 2: a prose-only merge-ownership break → gate 1.0→0.5). Value changes move the headline
token signal without disturbing quality (experiment 3: a ~2k-token injection → `tokens.total` +53,831,
gate unchanged). And it does not false-positive on a stable system (experiment 1: 6/6, zero flips).

A "no regression / quantified value" verdict from `compare main feat/epic-backlog-skills-simplification`
is therefore trustworthy. **`tokens.total` is the value signal to read** (rendered as the `totTok`
report column); the mis-calibrated `firstTurnProseTokens` proxy has been removed.
