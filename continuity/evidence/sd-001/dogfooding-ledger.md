# SD-001 Sustained Dogfooding Ledger

Append-only observational record for the sustained Nestfolio dogfooding
validation period. Previously appended bytes are never modified or deleted
(`LEDGER_APPEND_ONLY_VIOLATION` otherwise); a correction is a new entry
referencing the corrected one. Every entry carries machine-captured UTC
(`date -u` at capture). Entries are recorded in the session they measure
(`RETROACTIVE_MEASUREMENT_PROHIBITED` otherwise; gaps are recorded as
gaps). This ledger carries no rule authority and is never read by the
Continuity engine.

## Entry 0 — Period-start marker

- Entry written (machine-captured UTC): 2026-07-18T19:23:07.000Z
- Owner period-start confirmation (verbatim): "vai"
- Owner confirmation machine-captured UTC: 2026-07-18T19:22:53.000Z
- Published SD-001 contract revision (continuity-lab): 0585f8a576f914b3edfe2518e294730d20ccb87c
- Bound Nestfolio revision: 914456ce44c271d5bb38b22d985448011d6adcf9
- Protocol file SHA-256 (`continuity/evidence/sd-001/dogfooding-protocol.md`): 95f7f45ebc7212b6d0782cca6165c0f9d2a831ab39fd132f4e4c917ab43cd3bb
- Bound criteria source:
  - path: `docs/10-product/product-foundation.md`
  - repository: continuity-lab
  - revision: 8a8cc8cba0cbe2b40b8e9d058b7bcaf72dd7d0b1
  - SHA-256: 223df2894f1b265ea46d16ce9a6031d48d15078ce391cc10db8dab385563f3ab
  - section: "Sustained Nestfolio dogfooding success criteria — Provisional Validation Contract"
- Minimum dogfooding period: at least six consecutive weeks of active
  development; at least twenty non-trivial Work Items managed through
  Continuity; at least five multi-item or multi-session work efforts
  including at least two Epics or equivalent grouped workflows; at least
  fifteen resumptions after a session boundary or interruption.
- Period-start rule: the period begins at the committer UTC of the
  SD-001-PUB commit that lands this file on Nestfolio main. Publication is
  separately authorized and has not occurred as of this entry; the period
  has NOT begun yet.
- Zeroed counters:
  - non-trivial Work Items: 0 of 20
  - multi-item efforts: 0 of 5 (Epics or equivalent: 0 of 2)
  - resumption samples: 0 of 15
  - active weeks: 0 of 6

## Entry 1 — Failure-visibility event: stale backlog index surfaced fail-closed (criterion 11 input)

- Entry written (machine-captured UTC): 2026-07-18T19:59:57.000Z
- Session: Claude Code session 51cae0e8-25e2-4676-9657-0242547c7bb0 (first SD-001 period working session)
- Event: /backlog-next preflight backlog-gate failed with the typed diagnostic
  `backlog-index-matches staleness` ("BACKLOG.md is out of date — run
  backlog-lint --fix"): docs/BACKLOG.md had not been regenerated after the
  pre-period MI-006-R1 ship of dashboard-bff-awaiting-confirmation-activity-gap
  (2026-07-18T13:26Z, before period start). Fail-closed: workstream start was
  blocked until fixed; no silent continuation.
- Resolution: backlog-lint --fix regeneration, committed as 6c75d4d1 on
  Nestfolio main and pushed; preflight then passed.

## Entry 2 — Practical work selection event (criterion 5 input)

- Entry written (machine-captured UTC): 2026-07-18T19:59:57.000Z
- Session: Claude Code session 51cae0e8-25e2-4676-9657-0242547c7bb0
- Selection route: /backlog-next Step-1 deterministic rule (no ACTIVE non-epic
  item, therefore top-ranked QUEUED, rank 1), invoked through the MI-001D 1.0.1
  Level 1 boundary (continuity:doctor and continuity:verify both "ready";
  single active nestfolio.level-1@1.0.1 Pack, nestfolio.backlog-next@1.0.1
  Procedure, 19/19 locked assets verified).
- Selected: e2e-live-suite-exceeds-bedrock-daily-token-budget (type infra,
  rank 1, no epic pointer).
- The pick came from docs/BACKLOG.md repository state; no manual
  priority/dependency reconstruction from chat.

## Entry 3 — Non-trivial Work Item first appearance (criterion 4 input)

- Entry written (machine-captured UTC): 2026-07-18T19:59:57.000Z
- Work Item: e2e-live-suite-exceeds-bedrock-daily-token-budget
- Classification at first appearance: NON-TRIVIAL — real infrastructure work
  (making one full live-AgentCore e2e run fit the dev-account Bedrock daily
  token budget) with three explicit completion criteria in the store Work Item
  (e2elb-c1-gap-sizing, e2elb-c2-fix-direction, e2elb-c3-budget-fit); not pure
  Continuity bookkeeping, not typo-class.
- Continuity management: Work Item, Scope (scope-e2e-live-budget), and Working
  Set (ws-e2e-live-budget) prepared through the pinned store API (the
  MI-005/MI-006-R1 evidenced mechanism; no continuity/bindings file) at
  2026-07-18T19:56:11.495Z; Run run-e2e-live-budget started at
  2026-07-18T19:56:18.782Z (session-e2e-live-budget-1); keyed effect
  e2elb-measurement-plan-v1 recorded (measurement plan plus static model-pin
  analysis: the six production AgentConfigs pin THREE inference profiles —
  Haiku 4.5, Sonnet 4-6, and Nova Pro — not the two assumed by the dossier);
  verified Checkpoint run-e2e-live-budget-cp-1 at 2026-07-18T19:58:05.215Z;
  Handoff published; Run interrupted resumable (the gap-sizing measurement was
  blocked in-session: no AWS credentials available).
- No completion claim; all three criteria pending.

## Entry 4 — Skill-reuse events (criterion 6 input)

- Entry written (machine-captured UTC): 2026-07-18T19:59:57.000Z
- Real task: selection and start of
  e2e-live-suite-exceeds-bedrock-daily-token-budget (entries 2-3).
- Invocations on this real task: backlog-next (through the Level 1 boundary),
  continuity-resumable-work (adapter CLI drive: start / effect / checkpoint /
  interrupt), continuity-nestfolio-binding (backlog-authority and store-mirror
  rules applied), backlog-lint (--fix index regeneration, entry 1).

## Entry 5 — Overhead sample (criterion 9 input)

- Entry written (machine-captured UTC): 2026-07-18T19:59:57.000Z
- Contemporaneous self-report for this session: total active time ≈ 35 min;
  Continuity bookkeeping and state recording (session gates, protocol and
  contract reads, store preparation, ledger appends, handoff authoring)
  ≈ 20 min; development-directed work (selection, dossier analysis, model-pin
  extraction, measurement-plan authoring) ≈ 15 min; overhead ≈ 57%.
- Context recorded truthfully: this first period session carried one-off
  bootstrap costs (store-preparation scripting, first weekly entry). No
  target claim either way.

## Entry 6 — Weekly entry, week 1

- Entry written (machine-captured UTC): 2026-07-18T19:59:57.000Z
- Period start (SD-001-PUB commit bd0b2fcc committer UTC, measured from git):
  2026-07-18T19:39:42Z. Note: a session prompt cited 21:39:42Z, which is the
  same instant in local +02:00 mislabeled as UTC; week windows count from
  2026-07-18T19:39:42Z.
- Week 1 window: 2026-07-18T19:39:42Z to 2026-07-25T19:39:42Z; ACTIVE (this
  dogfooded working session).
- Activity: first backlog-routed Work Item selected and begun through the
  Continuity Level 1-6 mechanisms (entries 1-5).
- Running counters:
  - non-trivial Work Items managed through Continuity: 1 of 20 (0 completed)
  - multi-item efforts: 0 of 5 (Epics or equivalent: 0 of 2)
  - resumption samples: 0 of 15
  - active weeks: 1 of 6

## Entry 7 — Correction of Entry 3's "no AWS credentials" claim (references Entry 3)

- Entry written (machine-captured UTC): 2026-07-18T20:17:41.000Z
- Session: Claude Code session 51cae0e8-25e2-4676-9657-0242547c7bb0 (same
  session as entries 1-6; continued after the owner pointed out the AWS
  profile).
- Correction: Entry 3 stated "the gap-sizing measurement was blocked
  in-session: no AWS credentials available." That was an EXECUTOR ERROR, not
  an environment block. Credentials were available all along via the
  `nestfolio-dev` profile declared in Nestfolio `.env`
  (`AWS_PROFILE=nestfolio-dev`, loaded by `.envrc` direnv `dotenv`); the
  executor ran `aws sts get-caller-identity` without selecting the profile
  and misread the empty default credential chain as "no credentials."
  `AWS_PROFILE=nestfolio-dev aws sts get-caller-identity` succeeds (account
  771924376645, AdminRole). The measurement was executed this session (Entry
  8). Entry 3's other facts stand.

## Entry 8 — Gap-sizing measurement result (criterion 1 input; e2elb-c1 MEASURED)

- Entry written (machine-captured UTC): 2026-07-18T20:17:41.000Z
- Measurement machine-captured UTC: 2026-07-18T20:14:06.000Z
- Evidence: continuity/dogfood/e2e-live-budget/gap-sizing.md (marker
  "e2elb-c1-gap-sizing: MEASURED"). Source: CloudWatch AWS/Bedrock + Service
  Quotas, account 771924376645, region us-east-1, burn day 2026-06-26 UTC
  (7,513 invocations, matches the dossier's ~7.2k).
- Material finding (overturns the dossier's per-day-exhaustion hypothesis):
  all 1,789 throttles were on Haiku 4.5; Sonnet 4-6 and Nova Pro had zero.
  Per-DAY usage of the heaviest model (Haiku) was only 4.8% of its
  tokens-per-day quota (17.1M / 357.1M), and the per-day quotas are
  Adjustable=false. The binding constraint is Haiku tokens-per-MINUTE / burst
  concurrency (EstimatedTPMQuotaUsage peaked at 49,264% on the burn day); the
  only adjustable quota lever is the Haiku cross-region TPM quota
  (L-58BE175A, adj=true). Material caveat: burn evidence is 22 days stale and
  the TPM quotas are mutable, so a current run must be re-measured before the
  gap can be projected onto today's quotas.
- The measurement corrected two errors in the recorded measurement plan: the
  metric names are InputTokenCount/OutputTokenCount (not the assumed
  Invocation*TokenCount), and the six production AgentConfigs pin THREE
  profiles (Haiku 4.5, Sonnet 4-6, Nova Pro).

## Entry 9 — Resumable-execution friction observation (criterion 3 input)

- Entry written (machine-captured UTC): 2026-07-18T20:17:41.000Z
- Observation: Run run-e2e-live-budget became NON-engine-resumable after its
  first-session artifacts were committed on Nestfolio main (commit 79a15c6c),
  which advanced HEAD. The engine freshness check
  (verifyFreshness -> repositoryFingerprint -> gitIdentity) binds to the git
  HEAD SHA, so `resume` returned STALE_RUN (expected fingerprint 94ff01f0 at
  HEAD 6c75d4d1, actual c12f1d81 at HEAD 79a15c6c). Verified: commit 79a15c6c
  touched no fingerprint_paths file — only the HEAD SHA changed. This is the
  same accepted, documented consequence class as run-mi005 becoming
  non-resumable by staleness after MI-006-R1. No material Work Item, scope,
  Decision, or completion-criterion loss: the next action was correctly
  identified from repository state (the published Handoff + measurement-plan
  effect), no duplicated or silently-skipped effect occurred, and the
  gap-sizing.md evidence was recorded as a direct Scope-declared-path work
  product instead of an engine effect (documented in the file).
- NOT a resumption sample: this continuation ran in the SAME Claude Code chat
  session (51cae0e8...) with full chat context, so it is NOT a fresh-session
  resumption and is NOT counted toward the resumption-sample counter (stays
  0/15). Recorded here only as a resumable-execution friction finding.
- Practical consequence for cadence: during the period, a Run's own artifact
  commit ends that Run's engine-resumability; genuine cross-session
  resumptions must resume BEFORE committing (against the same HEAD), or the
  Work Item's eventual engine completion needs a fresh Run prepared against
  the then-current HEAD.

## Entry 10 — Skill-reuse and overhead addendum for the measurement continuation

- Entry written (machine-captured UTC): 2026-07-18T20:17:41.000Z
- Skill/procedure invocations on this real task: continuity-resumable-work
  (resume attempt via the adapter CLI, which surfaced the STALE_RUN finding);
  direct AWS CloudWatch get-metric-statistics / list-metrics and Service
  Quotas list-service-quotas per the recorded measurement plan (direct work,
  not a Skill).
- Overhead addendum (this continuation, ~25 min): development-directed work
  (real CloudWatch/quota measurement + analysis) ≈ 18 min; Continuity
  bookkeeping (ledger correction + evidence framing) ≈ 7 min; ≈ 28% overhead
  for this stretch, lower than the bootstrap-heavy Entry 5 sample as expected.

## Entry 11 — Fix-direction decision deferred by owner (criterion e2elb-c2 stays pending)

- Entry written (machine-captured UTC): 2026-07-18T20:22:21.000Z
- The gap-sizing finding (Entry 8) was presented to the human program owner
  in-session with three options (re-measure a current run first / raise the
  Haiku cross-region TPM quota / reduce Haiku burst concurrency). Owner reply:
  "Rimanda" (defer). No fix direction is chosen; criterion e2elb-c2 remains
  pending and NO fix-direction-decision record is created (a decision is never
  inferred or defaulted into existence). Only criterion e2elb-c1 (gap sizing)
  is measured so far; e2elb-c3 (budget-fit) untouched.
- No completion or per-criterion claim is made. The Work Item stays in
  progress; the recommended next diagnostic (re-measure one current
  live-AgentCore run against current quotas before committing to a fix)
  remains available for a later owner decision.

## Entry 12 — Fix-direction decision ratified: re-measure first (criterion e2elb-c2 input)

- Entry written (machine-captured UTC): 2026-07-18T21:48:19.000Z
- Session: fresh Claude Code session `e3b57e80-bf01-437d-b617-56b933cd2fa6`
  (new chat, no context from session `51cae0e8-...`; this is the session the
  standing period rules call the "DEFERRED fix-direction decision"
  resolution session).
- The Entry 8 gap-sizing finding was re-presented to the human program owner
  with four options (re-measure / raise the Haiku TPM quota / reduce Haiku
  burst concurrency / defer again), recommended option = re-measure. The
  owner first asked a clarifying question ("cosa consigli considerando che
  ora il focus è sullo sviluppo di continuity più che su nestfolio?" —
  verbatim); the assistant answered that re-measurement is fully scripted,
  low-cost work that does not draw attention from Continuity development,
  unlike the TPM-quota-increase request or the burst-reduction
  implementation (both deferred), and re-affirmed the re-measure
  recommendation. Owner reply (verbatim): "Sì, rimisura ora (Raccomandato)".
- Decision recorded (mode `human-review-authorization`, verbatim reply,
  machine-captured UTC): `continuity/dogfood/e2e-live-budget/fix-direction-decision.json`,
  `decision: "re-measure-current-run-first"`. No decision was inferred; the
  clarifying exchange preceded the captured ratification.

## Entry 13 — Re-measurement executed; result informative, not decisive (criterion e2elb-c2 input; failure-visibility event)

- Entry written (machine-captured UTC): 2026-07-18T21:48:19.000Z
- Session: `e3b57e80-bf01-437d-b617-56b933cd2fa6`
- Ran the live-AgentCore e2e suite once against current quotas
  (`pnpm nx run e2e-feature-tests:test-e2e-features`, `AWS_PROFILE=nestfolio-dev`),
  2026-07-18T20:56:19.000Z–2026-07-18T21:44:48.000Z (≈48 min, 5,173 Bedrock
  invocations, 68.9% of the 2026-06-26 reference burn's 7,513). Evidence:
  `continuity/dogfood/e2e-live-budget/remeasure-2026-07-18.md`.
- Result: **zero `InvocationThrottles` on all three models this run**
  (Haiku/Sonnet/Nova), vs. 1,789 Haiku throttles on the reference burn, at
  unchanged TPM quota values (Haiku `L-58BE175A` still 5,000,000).
- Failure-visibility event (fail-closed, not silently swallowed): the run
  surfaced two findings independent of the budget question, both left
  undiagnosed and unfixed as out of this session's authorized scope: (1)
  `getaddrinfo ENOTFOUND events.us-east-1.amazonaws.com` /
  `...ddb.us-east-1.amazonaws.com` DNS-resolution failures during the run,
  which failed 3 contract-emission suites at fixture setup before any
  Bedrock call, suppressing part of this run's invocation volume; (2) three
  live-AgentCore decision-cycle scenarios (`first-decision`,
  `rebalance-on-drift`, `operating-mode-recommendation-shape` ×3 cases)
  timed out on `withProfileSnapshot(): ... not materialised within 360s`,
  cause undetermined (same DNS issue vs. genuine AgentCore-side slowness).
  7 of 28 test suites failed (24/56 tests); Jest exited non-zero.
- Because of (1) and (2), this measurement is honestly recorded as
  informative but not decisive: it cannot confirm today's quotas no longer
  throttle a full CLEAN pass, only that a partial, DNS-degraded pass at
  68.9% of reference volume produced zero throttles. No period-verdict or
  per-criterion completion claim is made; `e2elb-c2-fix-direction` itself
  (whether a further quota-increase or burst-reduction fix is still
  warranted) stays open for a future owner decision informed by this file.
  `e2elb-c3-budget-fit` remains untouched.

## Entry 14 — Resumption sample (criterion 3 input; counter 0/15 → 1/15)

- Entry written (machine-captured UTC): 2026-07-18T21:48:19.000Z
- Fresh-session identity: Claude Code session
  `e3b57e80-bf01-437d-b617-56b933cd2fa6`, launched via the handoff mechanism
  with no chat context from the prior session (`51cae0e8-...`) that left
  `e2elb-c2` deferred (Entry 11).
- Source of next action: repository artifacts, not chat memory — `git
  status -sb` / HEAD SHA checks against the pinned starting revisions in the
  session prompt, `continuity/dogfood/e2e-live-budget/gap-sizing.md`, and
  `continuity/evidence/sd-001/dogfooding-ledger.md` Entry 11 (the deferred
  decision marker). The session prompt itself was authored from that same
  repository state by the prior session, not recalled informally.
- Proved correct: yes — the repository state accurately identified the
  pending decision (e2elb-c2) and the correct non-resumability of
  `run-e2e-live-budget` (Entry 9), which this session did not attempt to
  resume; the re-measurement was recorded as a new Scope-declared-path file
  per the same documented pattern as `gap-sizing.md`, not as an engine
  effect.
- Material-loss / duplicated-effect / silently-skipped-step check: none
  observed. `gap-sizing.md` was not re-measured or edited; no engine Run
  resume was attempted (would have raised `STALE_RUN`); no step from the
  prior session was silently skipped or duplicated.

## Entry 15 — Skill-reuse and overhead addendum (criterion 6 and 9 inputs)

- Entry written (machine-captured UTC): 2026-07-18T21:48:19.000Z
- Skill/procedure invocations on this real task: `continuity-repository-status`
  (starting-revision verification across all three repositories).
  `AskUserQuestion` used twice for the human-review-authorization capture
  (initial options presentation, then a confirmation round after the
  owner's clarifying question) — direct interaction, not a Skill.
  CloudWatch/Service Quotas queries and the live-suite invocation were
  direct work per the recorded pattern from the prior session's measurement
  plan, not a Skill invocation.
- Overhead sample: total active time this session ≈ 60 min; development-
  directed work (owner Q&A, running/reading the live suite, CloudWatch
  analysis, writing `remeasure-2026-07-18.md`) ≈ 48 min (dominated by the
  live suite's own ≈48 min wall-clock, run in the background while no other
  Continuity bookkeeping proceeded); Continuity/ledger bookkeeping
  (starting-revision checks, decision-record JSON, ledger entries, handoff)
  ≈ 12 min; ≈ 20% overhead for this session, lower than both prior samples
  (Entry 5 ≈57%, Entry 10 ≈28%) because the dominant cost was the live
  suite's own real runtime, not Continuity process.

## Entry 16 — Fix-direction decision round 2: no quota fix pursued, monitor and revisit (criterion e2elb-c2 input)

- Entry written (machine-captured UTC): 2026-07-18T22:00:12.000Z
- Session: fresh Claude Code session `ffab733b-cc5f-44fd-98fd-1cad12a81efd`
  (new chat, no context from session `e3b57e80-...` that executed the
  re-measurement recorded in Entry 13).
- The confounded re-measurement result (Entry 13 /
  `remeasure-2026-07-18.md`) was re-presented to the human program owner via
  `AskUserQuestion` with five options (accept current evidence / re-measure
  again / request the Haiku TPM quota increase / reduce Haiku burst
  concurrency / defer again), recommended option = accept current evidence
  and spend no further AWS/Bedrock budget on another live re-measurement.
  Owner selected the recommended option.
- Decision recorded (mode `human-review-authorization`, machine-captured
  UTC): `continuity/dogfood/e2e-live-budget/fix-direction-decision-round-2.json`
  — `decision: "no-quota-fix-pursued-monitor-and-revisit"`. This is a NEW
  file alongside `fix-direction-decision.json` (round 1, unedited); round 1
  decided to re-measure first (executed), round 2 decides what to do with
  that re-measurement's result. No decision was inferred.
- Effect: `e2elb-c2-fix-direction` is resolved for this period without a
  quota-increase request or a burst-reduction implementation session; no
  further live-suite re-measurement is scheduled. Revisit only if a future
  live `e2e-feature-tests` run against AWS actually throttles again.
  `e2elb-c3-budget-fit` remains untouched. No period-verdict or
  per-criterion completion claim is made by this entry.

## Entry 17 — Two side-findings from the re-measurement filed to backlog (criterion 6/9 input)

- Entry written (machine-captured UTC): 2026-07-18T22:03:00.000Z
- Session: `ffab733b-cc5f-44fd-98fd-1cad12a81efd`
- The owner separately authorized (via `AskUserQuestion`, recommended
  option accepted) filing the two operational findings surfaced by the
  re-measurement (Entry 13) as backlog items, since until now they existed
  only in the SD-001 ledger. Used the `backlog-add` skill's intake driver
  (`runtime/adapters/claude-code/run-intake.mjs`) for both, per its
  finding→route→write mechanism (not a manual file write).
- Routing: both findings were checked against the active epic
  (`runtime-self-hosting-debt` — unrelated, internal runtime/ code-quality
  debt) and every parking theme epic; neither matched. Both were also
  checked against their nearest thematic precedents, which are all
  `status: shipped` (closed), not open parking items, so folding/joining was
  not available: `test-integration-parallel-dns-exhaustion` (shipped
  2026-06-23; its own out-of-scope note explicitly predicted "a separate
  item if e2e ever shows DNS exhaustion" — apps/e2e-feature-tests was never
  wired with its `installDnsResilience` fix) for the DNS finding;
  `e2e-fixture-agentcore-synchronous-coupling` (shipped 2026-05-21, the
  `withProfileSnapshot()` fixture itself) and
  `scenario-12-rebalance-on-drift-missing-mandate-fixture` (shipped
  2026-05-18, same InvestorProfileSnapshot-materialisation area) for the
  timeout finding. Both were filed as new parking orphans:
  `docs/backlog/from-e2elb-remeasure-2026-07-18-dns-enotfound.md` and
  `docs/backlog/from-e2elb-remeasure-2026-07-18-withprofilesnapshot-timeout.md`.
  `backlog-lint` passed (464 files, all 11 rules) after both filings.
  Committed on `main` (see HEAD SHA in the closing entry of this session).

## Entry 18 — Failure-visibility event: accidental amend of the published starting-HEAD commit, caught pre-push and corrected

- Entry written (machine-captured UTC): 2026-07-18T22:10:00.000Z
- Session: `ffab733b-cc5f-44fd-98fd-1cad12a81efd`
- While committing the two backlog filings from Entry 17, a leftover
  `--amend` in a chained shell command (intended as a dead fallback guarded
  by `2>/dev/null`, not meant to execute) instead ran successfully and
  amended the published starting-HEAD commit `9c3e842b686f0fca8cee34cd09acc32824b79630`
  ("Record e2elb-c2 re-measurement decision and result in SD-001 ledger")
  into a new commit `ecc61e9f` carrying an incomplete message and the two
  backlog files folded into it — a rewrite of already-pushed history.
- Caught immediately (before any push) by inspecting `git status -sb`
  ("diverged, 1 and 1 different commits") and `git log`. Verified the
  original commit object `9c3e842b` was still intact and reachable (git
  objects are immutable; `origin/main` still pointed at it, so it was never
  at risk). Corrected by backing up the two new backlog files, running
  `git reset --hard 9c3e842b686f0fca8cee34cd09acc32824b79630` to restore
  local `main` to exactly the original published commit, restoring the two
  files, and committing them fresh as a new commit
  (`8980a1ab71e58194512d169a10100066cb1ad61f`,
  "docs(backlog): file DNS-exhaustion and withProfileSnapshot-timeout e2e
  findings") on top of the unmodified `9c3e842b`. `origin/main` was never
  pushed to or altered; no published history was actually rewritten on the
  remote. Verified post-fix: `git log` shows `9c3e842b` unchanged as the
  parent of `8980a1ab...`, local `main` ahead of `origin/main` by exactly 1
  commit, working tree clean.
- Root cause: an unnecessary defensive fallback command
  (`git commit --amend --no-edit 2>/dev/null`) was left in a compound shell
  invocation instead of being removed once no longer needed — a process
  error, not a tooling failure. No further action needed beyond this
  disclosure; no data or published state was lost.

## Entry 19 — Resumption sample (criterion 3 input; counter 1/15 → 2/15)

- Entry written (machine-captured UTC): 2026-07-18T22:12:00.000Z
- Fresh-session identity: Claude Code session
  `ffab733b-cc5f-44fd-98fd-1cad12a81efd`, launched via the handoff mechanism
  with no chat context from the prior session (`e3b57e80-...`) that executed
  the re-measurement (Entry 13) and left the round-2 fix-direction decision
  open.
- Source of next action: repository artifacts, not chat memory — `git
  status -sb` / HEAD SHA checks against the pinned starting revisions in the
  session prompt (nestfolio `9c3e842b`, continuity-lab `52c5b2e1`), plus
  `remeasure-2026-07-18.md` and ledger Entries 12-13. The session prompt
  itself was authored from that same repository state by the prior session,
  not recalled informally.
- Proved correct: yes — the repository state accurately identified the
  pending round-2 decision and the correct non-resumability of
  `run-e2e-live-budget` (not attempted). The round-2 decision was recorded
  as a NEW file (`fix-direction-decision-round-2.json`) alongside the
  round-1 file, per the session prompt's explicit instruction not to
  overwrite it in place.
- Material-loss / duplicated-effect / silently-skipped-step check: the
  session did hit one material near-loss (Entry 18, an accidental amend of
  the published starting-HEAD commit) — caught and corrected before any
  push, with no actual loss of published state. No other material loss,
  duplicated effect, or silently-skipped step observed; `gap-sizing.md` and
  `remeasure-2026-07-18.md` were not re-measured or edited, no engine Run
  resume was attempted, no step from the prior session was duplicated.

## Entry 20 — e2elb-c3-budget-fit structural tension disclosed and dispositioned: Work Item blocked/deferred, no fix chosen

- Entry written (machine-captured UTC): 2026-07-18T22:29:26.000Z
- Session: fresh Claude Code session `d6825ea2-a76d-4000-9076-0bb7ed386384`
  (new chat, no context from session `ffab733b-...` that recorded the
  e2elb-c2 round-2 decision in Entries 16-17).
- Structural tension (discovered and disclosed, not resolved, in the prior
  session per Entries 16-17): `e2elb-c3-budget-fit` requires a "chosen fix"
  to be implemented and validated, but the `e2elb-c2-fix-direction`
  round-2 decision explicitly chose `no-quota-fix-pursued-monitor-and-revisit`
  — no fix was chosen. As literally written, c3 is therefore currently
  unsatisfiable through its intended path.
- The tension was presented to the human program owner in full via
  `AskUserQuestion` (literal criterion text, literal round-2 decision text,
  and the two structural alternatives: reverse course on a fix direction,
  or treat the Work Item as not-completable under its current criteria for
  now), with three options offered — (i) RECOMMENDED: record the Work Item
  as blocked/deferred and route to a different backlog item via
  `/backlog-next` for now, revisiting only on a future real throttle or a
  priority shift back to Nestfolio; (ii) reverse course now and choose a
  fix direction, a new decision requiring a dedicated escalated-model
  session; (iii) defer the disposition itself, no action beyond disclosure.
  Owner selected the recommended option (i).
- Recording mechanism: before recording, the pinned engine
  (`runtime/continuity/lib/{store,workflow}.mjs`, the claude-code CLI
  adapter) was inspected directly. No CLI subcommand or store-API function
  exists to mark a work item blocked/deferred while leaving
  `completion_criteria` untouched; the only two mechanical options found
  were `interrupt` on the active Run (touches Run/Session status only, not
  the work item) or a direct `store.writeArtifact` on the whole work-item
  envelope in the MI-005/MI-006-R1 style (which in that precedent always
  rewrote `completion_criteria` too). Per the session prompt's explicit
  "stop and ask rather than guess" instruction, this finding was presented
  to the owner via a second `AskUserQuestion` with a third option: no
  pinned-store mutation this session, record via a standalone decision
  file plus this ledger append, mirroring the e2elb-c2 round-2 precedent
  exactly. Owner selected that recommended option.
- Decision recorded (mode `human-review-authorization`, machine-captured
  UTC 2026-07-18T22:29:26.000Z):
  `continuity/dogfood/e2e-live-budget/c3-disposition-decision.json` —
  `decision: "blocked-deferred-no-fix-chosen"`.
- Effect: the Work Item `e2e-live-suite-exceeds-bedrock-daily-token-budget`
  is treated as blocked/deferred — not completed, not abandoned. No
  mutation was made to the pinned work-item envelope: status remains
  `in_progress`, all three `completion_criteria` remain exactly as
  recorded (pending), no per-criterion completion or failure claim is made
  by this entry or the decision file. No AWS Service Quota increase
  request submitted, no burst-reduction implementation session opened, no
  further live-suite re-measurement scheduled. Revisit e2elb-c3 only if a
  future live `e2e-feature-tests` run against AWS actually throttles
  again, or if program priority shifts back toward Nestfolio work. The
  recommended next operation is to route to a different backlog item via
  `/backlog-next`.

## Entry 21 — Resumption sample (criterion 3 input; counter 2/15 → 3/15)

- Entry written (machine-captured UTC): 2026-07-18T22:29:26.000Z
- Fresh-session identity: Claude Code session
  `d6825ea2-a76d-4000-9076-0bb7ed386384`, launched via the handoff
  mechanism with no chat context from the prior session
  (`ffab733b-cc5f-44fd-98fd-1cad12a81efd`) that recorded the e2elb-c2
  round-2 decision and left the e2elb-c3 structural tension disclosed but
  undispositioned.
- Source of next action: repository artifacts, not chat memory — `git
  status -sb` / HEAD SHA checks against the pinned starting revisions in
  the session prompt (nestfolio `1d474c95`, continuity-lab `52c5b2e1`),
  plus `fix-direction-decision-round-2.json`, the work-item JSON's
  `completion_criteria`, and ledger Entries 16-17. The session prompt
  itself was authored from that same repository state by the prior
  session, not recalled informally.
- Proved correct: yes — the repository state accurately identified the
  undispositioned e2elb-c3 tension and the correct non-resumability of
  `run-e2e-live-budget` (not attempted; no engine command was invoked this
  session).
- Material-loss / duplicated-effect / silently-skipped-step check: no
  material loss, duplicated effect, or silently-skipped step observed;
  `fix-direction-decision-round-2.json` was not re-measured or edited, no
  engine Run resume was attempted, no step from the prior session was
  duplicated.

## Entry 22 — Resumption sample (criterion 3 input; counter 3/15 → 4/15)

- Entry written (machine-captured UTC): 2026-07-19T09:07:00.000Z
- Fresh-session identity: Claude Code session
  `02f14ef3-8391-4a1c-b8df-f40fb8578d1c`, launched via the handoff
  mechanism with no chat context from the prior session
  (`d6825ea2-a76d-4000-9076-0bb7ed386384`) that dispositioned e2elb-c3.
- Source of next action: repository artifacts, not chat memory — `git
  status -sb` / HEAD SHA checks against the pinned starting revisions in
  the session prompt (nestfolio `897176bc`, continuity-lab `52c5b2e1`),
  `npm run continuity:doctor`/`continuity:verify` (both "ready"), then
  `docs/BACKLOG.md` repository state. The session prompt itself was
  authored from that same repository state by the prior session, not
  recalled informally.
- Proved correct: yes — the repository state accurately identified that
  QUEUED rank 1 is still `e2e-live-suite-exceeds-bedrock-daily-token-budget`
  (the same blocked/deferred Work Item from Entry 20, `docs/backlog`
  frontmatter unchanged at `status: queued` because the c3 disposition
  deliberately touched only the pinned store, not the backlog-next
  file — see Entry 20).
- Material-loss / duplicated-effect / silently-skipped-step check: no
  material loss, duplicated effect, or silently-skipped step observed; no
  engine Run resume was attempted (none was pending); no step from the
  prior session was duplicated.

## Entry 23 — Practical work-selection event, second item this period (criterion 5 input)

- Entry written (machine-captured UTC): 2026-07-19T09:07:00.000Z
- Session: `02f14ef3-8391-4a1c-b8df-f40fb8578d1c`
- Conflict identified before selecting: `/backlog-next`'s default Step-1
  deterministic pick (no ACTIVE non-epic item → top-ranked QUEUED, rank 1)
  resolves to `e2e-live-suite-exceeds-bedrock-daily-token-budget` — the
  same Work Item this same session's prompt had just described as
  blocked/deferred with an explicit "do not reopen speculatively" note
  (Entry 20). Presented to the owner via `AskUserQuestion`: skip to rank 2
  via an explicit `<id>` argument (recommended) vs. follow the literal
  deterministic pick anyway. Owner selected the recommended option.
- Selected: `e2e-fixtures-test-stale-detail-envelope-assertion` (type bug,
  rank 2, no epic pointer, `status: queued`) via
  `/backlog-next e2e-fixtures-test-stale-detail-envelope-assertion` (Step-1
  "with `<id>` argument" / `queued` → proceed regardless of rank).
- Classification: Simple lane (single app, `apps/e2e-feature-tests/test/
  helpers/fixtures.test.ts`, no deploy, no public-interface change, no
  architectural decision) — worked directly on `main`.

## Entry 24 — Non-trivial Work Item worked through the engine; fix landed, ship-gate blocked (criteria 4/5 input)

- Entry written (machine-captured UTC): 2026-07-19T09:07:00.000Z
- Session: `02f14ef3-8391-4a1c-b8df-f40fb8578d1c`
- Classification at first appearance: NON-TRIVIAL — a real, verified bug
  fix (two stale-assertion e2e-fixture unit tests asserting the
  pre-migration flat `detail:{}` EB envelope instead of the DRY
  `{context, subject}` shape the fixtures actually emit), not pure
  Continuity bookkeeping, not typo-class.
- Continuity management: driven through the pinned engine, not hand-run —
  `node runtime/adapters/claude-code/run-next.mjs
  e2e-fixtures-test-stale-detail-envelope-assertion` (parked at
  `execute:<id>`, lane initially misread as `doc-layer` because the fix
  was not yet committed and the adapter's lane classifier reads the
  committed `origin/main...HEAD` diff, not the working tree). The fix was
  implemented (root-caused against `apps/e2e-feature-tests/src/helpers/
  fixtures.ts`'s actual emitted shapes), verified green (scoped
  `JEST_PATH=helpers/fixtures.test.ts` run: 5/5 passing, was 3/5), and
  committed (`4358626e0fb9889748ca177568e3d2702fba17f8`) before fulfilling
  the execute step, so the re-run correctly classified `lane: "simple"`.
- `detect-doc-derivation.mjs` correctly reported no derivation needed
  (exit 10); `tools/affected-projects.mjs` correctly scoped affected
  projects to `e2e-feature-tests,nestfolio-e2e`, both lint-clean (0
  errors).
- Outcome: fix is real, verified, and committed+pushed on `main`, but the
  Work Item's own ship-gate could not be honestly closed this session —
  see Entry 25. `docs/backlog/e2e-fixtures-test-stale-detail-envelope-
  assertion.md` frontmatter left at `status: queued` (unchanged); no
  per-criterion or ship claim made for it.

## Entry 25 — Failure-visibility event: pre-ship gate blocked on pre-existing whole-scope debt, unrelated to the item's own diff

- Entry written (machine-captured UTC): 2026-07-19T09:07:00.000Z
- Session: `02f14ef3-8391-4a1c-b8df-f40fb8578d1c`
- The `run-next.mjs` pre-ship deploy-gate (lane `simple` → trigger
  `{contexts:[audit], cost_ceiling:expensive, on:item-pre-ship}`) ran the
  `audit-e2e-test` judgment check. That check's `scope.paths` is
  `apps/e2e-feature-tests/**` (whole-app), so once selected by
  `findByScope` it audited the entire app, not just the one changed file,
  and returned `status: "failed"` with 4 findings — all in files never
  touched by this item's 4-line diff (forbidden `@nestfolio/
  integration-testing` import in 2 files; direct-DDB-read-without-
  justification-comment in 5 files; 3 helpers missing from the
  `src/index.ts` barrel; 5 files hand-rolling polling instead of the
  shared `poll()` helper). Fail-closed, not silently swallowed.
- This reproduces, in a NEW manifestation (a pre-ship judgment-tier
  `audit` check rather than a start-gate `invariant` check), the exact
  systemic pattern already tracked in the backlog as unresolved
  (`runtime-gate-baseline-debt` epic / `gate-surfaced-source-debt`
  member, both `status: parking`): item-gates evaluate whole-scope, so
  pre-existing tree debt blocks a narrowly-scoped item's completion.
  The documented `curate` ritual (SKILL.md §6.4b) is wired to a
  DIFFERENT, later trigger name (`--trigger ship-gate|dangling-scope` via
  `runtime/adapters/git/ship-recheck.mjs`), not to this pre-ship
  `item-pre-ship` trigger — no already-wired escape valve was found for
  this specific block. Re-running would not help without a new commit
  (`preShipBatch` short-circuits on unchanged SHA via `e2eIsFresh`).
- Presented to the owner via `AskUserQuestion` with three options: (i)
  RECOMMENDED — treat the item as blocked by the pre-existing debt (leave
  `docs/backlog` status `queued`, unchanged; file the 4 findings; route
  to the next backlog item); (ii) expand scope to also fix the 4
  unrelated findings so the gate passes clean; (iii) investigate the
  `curate` ritual despite the trigger-name mismatch. Owner selected the
  recommended option (i).
- Effect: `e2e-fixtures-test-stale-detail-envelope-assertion` is treated
  as blocked on ship-gate closure only — its own fix is done, verified,
  and safely committed independent of the Work Item's bookkeeping (Entry
  24). No further pre-ship retry attempted this session.

## Entry 26 — Backlog filing event, including a caught-and-reverted data-loss near-miss (criteria 6/9 input)

- Entry written (machine-captured UTC): 2026-07-19T09:07:00.000Z
- Session: `02f14ef3-8391-4a1c-b8df-f40fb8578d1c`
- Per the Entry 25 disposition, the 4 pre-ship findings were filed to the
  backlog. Finding #0 (the forbidden-import finding) was already filed
  2026-07-06 as `docs/backlog/from-audit-e2e-test.md`
  (`provenance.from_finding: audit-e2e-test#0`) — confirmed a duplicate,
  not re-filed.
- Attempted the sanctioned intake driver
  (`node runtime/adapters/claude-code/run-intake.mjs --finding <f1.json>
  --fulfil execute:intake-audit-e2e-test#1 --value '...route:"orphan"...'`)
  for finding #1 (the DDB-read-justification finding). It returned
  `"written": ["docs/backlog/from-audit-e2e-test.md"]` — the SAME path as
  finding #0's already-filed item — and had silently overwritten finding
  #0's `done_when`/body with finding #1's content. Caught immediately via
  `git diff` (uncommitted) before any commit; reverted with `git checkout
  -- docs/backlog/from-audit-e2e-test.md`; verified restored (`git diff`
  clean). No data was actually lost (never committed, let alone pushed).
- Root cause identified: `run-intake.mjs`'s orphan route derives the
  written filename from `from-<check-id>` alone, not from the finding's
  own id, so a second orphan-routed finding from the same check collides
  with and overwrites the first. Filed as a new backlog item
  (`run-intake-orphan-route-filename-collision`) so the driver is not
  reused unsafely for repeat same-check findings until fixed.
- Given the demonstrated collision, the remaining 3 findings (#1 DDB-read
  justification, #2 barrel-export gap, #3 poll()-helper duplication) were
  filed manually per the `backlog-add` skill's documented template/
  procedure (used as the semantics reference for exactly this case) with
  distinct ids, `status: parking`, no epic match (checked the active
  `runtime-self-hosting-debt` epic's `scope:`/`out_of_scope:` and every
  parking theme epic by root cause; none matched) → plain orphans.
  `node .claude/skills/backlog-lint/lint.mjs --fix`: 468 files, all 11
  rules pass. Committed
  (`948752c42469599d27a27cd54d72723d75331979`) and pushed to
  `origin/main` (`897176bc..948752c4`).

## Entry 27 — Session-boundary model-tier escalation note for the next Work Item (model-policy input)

- Entry written (machine-captured UTC): 2026-07-19T09:07:00.000Z
- Session: `02f14ef3-8391-4a1c-b8df-f40fb8578d1c`
- `/backlog-next`'s deterministic pick for a third item this period would
  again require an explicit `<id>` (rank 1 and rank 2 are both still
  QUEUED and effectively blocked per Entries 20 and 25): rank 3,
  `circuit-breaker-lifecycle-e2e-breaker-stuck-open` (type bug, root
  cause unconfirmed between two hypotheses — test-isolation state-leak vs.
  Bedrock-throttle-storm collateral — its own documented cheapest-next-
  step is "run scenario 14 in isolation [against live AWS] and inspect
  the broker-alpaca-adpt breaker-state row before/after").
- Per the workspace model policy (`continuity-workspace/CLAUDE.md` §
  "Model policy"), root-causing a live-AWS e2e flake between two
  hypotheses is genuine hard-debugging judgment work, not scripted
  routing — it calls for `claude-fable-5`/`claude-opus-4-8`, not
  `claude-sonnet-5` (this session's model). This session did not adopt,
  classify, or begin executing this item (no `docs/backlog` status
  change, no engine `run-next.mjs` invocation for it) so as not to spend
  live-AWS budget or a preliminary judgment pass on the cheaper tier that
  would need redoing. Recommended next operation: a fresh session
  launched with `claude-fable-5` to select and execute this item (or the
  next-ranked alternative if priorities have shifted).

## Entry 28 — Work-selection: circuit-breaker-lifecycle-e2e-breaker-stuck-open selected and started; session interrupted early at owner request (budget), diagnostic evidence preserved

- Entry written (machine-captured UTC): 2026-07-19T10:29:11.000Z
- Session: `a35b469b-da36-4b9d-b7ec-1b29ed4108f0` (launched on
  `claude-fable-5` per Entry 27's escalation note)
- Starting revisions confirmed (nestfolio `a7a7c65e` clean/in-sync, lab
  `52c5b2e1` clean, workspace clean). Continuity Level 1 preflight green
  (doctor+verify: pack `nestfolio.level-1@1.0.1`, procedure
  `nestfolio.backlog-next@1.0.1`, 19/19 locked assets verified).
  `/backlog-next circuit-breaker-lifecycle-e2e-breaker-stuck-open`
  invoked with explicit id (rank 1/2 still blocked per Entries 20/25;
  BACKLOG.md re-checked fresh — no new rank-1-eligible item).
  Skill preflight green. Item is `queued`, type bug, no epic pointer →
  proceed. Engine started: `run-next.mjs` parked (exit 3) at
  `execute:circuit-breaker-lifecycle-e2e-breaker-stuck-open` awaiting a
  session-executor TaskResult; no repo write from the engine.
- Diagnostic evidence gathered (static, no live-AWS spend yet):
  (1) enforcement point found — AppSync pipeline fn
  `investor-bff/src/graphql/js-function/check-feature-flag.fn.js` reads
  `FeatureFlag#SYSTEM/FeatureFlag#<mutation>` and throws exactly the
  observed `SERVICE_TEMPORARILY_UNAVAILABLE` / "This action is
  temporarily paused" when `enabled === false` → the Phase-1 failure
  means the flag row was false at that instant, despite the test's
  `beforeEach` `resetFeatureFlags()` writing true before the
  minutes-long fixture chain; (2) the flag writer is
  `investor-bff/src/handlers/broadcast-listener.ts` consuming
  BROKER_CIRCUIT_OPEN/CLOSED from a queue (at-least-once, reorderable
  under backlog) → AppSync `updateFeatureFlag`; (3) breaker state is a
  single GLOBAL row `CircuitBreaker#alpaca` in broker-alpaca-adpt;
  (4) `withBreakerOpen()` DISABLES the heal-SM EB rule
  (`dev-broker-alpaca-adpt-HealStateMachine*` on
  `dev-execution-event-bus`) before opening; `closeBreakerFixture()`
  re-enables it only BEST-EFFORT and the whole test `afterEach` is
  best-effort → an interrupted/crashed run can leak breaker-row OPEN
  with the production auto-heal rule still disabled ("stuck open"
  literal); (5) `CircuitBreakerRepository.writeBreakerOpenEvent` exists
  as a re-emission primitive — whether adapter handlers re-emit
  BROKER_CIRCUIT_OPEN on traffic arriving while the row is already OPEN
  is the pivotal unresolved question (if yes, a leaked OPEN row +
  `beforeEach` fixture traffic re-disables the flags after the reset,
  fully explaining the Phase-1 failure and unifying both hypotheses:
  throttle-storm as original crash cause, state-leak as the standing
  mechanism).
- Session interrupted at owner request (subscription budget at 93%)
  before the judgment phase. Nothing lost: evidence above + next
  diagnostic steps saved to the next-session handoff prompt. Engine park
  persists and is resumable. Counters unchanged: WI 2/20 (this item
  selected+started, not completed) · weeks 1/6 · resumptions 4/15 (this
  session is the planned session of its own handoff prompt, not a
  resumption sample; the NEXT fresh session continuing this item
  qualifies as sample 5/15).
- Model note: `claude-fable-5` was the right tier for this session's
  planned judgment work, but the session was cut before judgment; the
  remaining next chunk is scripted evidence collection with a documented
  decision tree, adequate for `claude-sonnet-5` with an explicit
  escalation guard (ambiguous verdict → stop and hand back to
  `claude-fable-5`).

## Entry 29 — Resumption sample (5/15) and work-continuation: circuit-breaker-lifecycle-e2e-breaker-stuck-open, scripted evidence phase

- Entry written (machine-captured UTC): 2026-07-19T10:38:16.000Z
- Session: `cfca3ac2-f281-4f21-9d77-645ce3b2b765` (launched on
  `claude-sonnet-5` per Entry 28's model note)
- This is a genuine fresh session continuing `circuit-breaker-lifecycle-
  e2e-breaker-stuck-open` from repository state (not the planned session
  of its own handoff prompt) → resumption sample 5/15.
- Starting revisions confirmed exactly as pinned in the session prompt:
  nestfolio HEAD `81d6c80b735ad9bb36e6eec94d635e15be9c2b25` clean on
  `main`, in sync with `origin/main`; continuity-lab HEAD
  `52c5b2e124580b09dc3dd4279054ceb9c9aad9a5` clean on `main`; workspace
  clean on `main`.
- Work-continuation: re-invoking the engine to confirm the same
  `execute:circuit-breaker-lifecycle-e2e-breaker-stuck-open` park, then
  running the scripted evidence-collection steps (pivotal re-emission
  question, fixture-traffic reachability, live-but-read-only dev-state
  snapshot) per the session prompt's pre-authorized decision tree.

## Entry 30 — Scripted evidence resolves the pivotal question NO; mechanism refuted, evidence ambiguous, escalating to `claude-fable-5` per the decision-tree guard

- Entry written (machine-captured UTC): 2026-07-19T10:41:02.000Z
- Session: `cfca3ac2-f281-4f21-9d77-645ce3b2b765`
- Engine re-invoked: `run-next.mjs circuit-breaker-lifecycle-e2e-breaker-
  stuck-open` parked again at the identical
  `execute:circuit-breaker-lifecycle-e2e-breaker-stuck-open` key, no
  repo write from the engine (`git status` showed only the ledger diff).
- (4a) Pivotal question — answered **NO**, with file:line evidence.
  `services/execution/broker-alpaca-adpt/src/handlers/event-listener.ts`:
  every handler (`processOrderRequested` L120-124,
  `processCancelRequested` L158-162, `processTransferRequested` L209-213,
  `processAccountCheck` L264-267) calls `checkBreaker()` first and, if
  already `OPEN`, returns immediately via a `rejectXAsBrokerUnavailable`
  helper — it never reaches `handleApiFailure`/`open()`/
  `writeBreakerOpenEvent()`. `handleApiFailure` (L25-36) — the only
  caller of `open()`/`writeBreakerOpenEvent()` — is invoked exclusively
  from each handler's `catch` block, i.e. only when `checkBreaker()` was
  `false` and the live API call then threw. Additionally
  `circuit-breaker.repository.ts`'s `open()` (L28-56) uses
  `ConditionExpression: 'attribute_not_exists(pk) OR #st <> :open'` — a
  second `open()` call while the row is already `OPEN` throws
  `ConditionalCheckFailedException`, is caught, and returns `false`;
  `writeBreakerOpenEvent()` is gated on `if (opened)` (L28-32) so it is
  never called on an already-open row. **There is no code path that
  re-emits `BROKER_CIRCUIT_OPEN` for traffic arriving while the breaker
  row is already `OPEN`.** This refutes the Entry 28 point-5 hypothesis
  as literally stated.
- (4b) Fixture-traffic reachability — checked
  `apps/e2e-feature-tests/src/helpers/fixtures.ts`: `onboarded()`
  (L65-113) emits `USER_REGISTERED` and `ONBOARDING_COMPLETED`, both
  `targetService: 'investor-bff'`; `funded()` (L162-214) emits
  `BALANCE_UPDATED`, also `targetService: 'investor-bff'`. **Neither
  fixture emits any event routed to `broker-alpaca-adpt`** — the
  `beforeEach` chain never invokes `checkBreaker()`/`open()` in that
  service at all, so it cannot be the trigger for any breaker-side
  state change during the reset window.
- (4c) Live dev-state snapshot (read-only, `AWS_PROFILE=nestfolio-dev`,
  account `771924376645`), recorded verbatim:
  - `CircuitBreaker#alpaca` row (table
    `dev-broker-alpaca-adpt-StateTable962DE04C-1DLYVT1905HSK`): `state:
    CLOSED`, `openedAt: 2026-07-18T21:28:13.195Z`, `closedAt:
    2026-07-18T21:28:15.517Z`, `reason: "E2E test — simulated failure"`.
  - Heal rule
    `dev-broker-alpaca-adpt-HealStateMachineBROKERCIRCUI-BvHeRXVNpPj7` on
    `dev-execution-event-bus`: `State: ENABLED`.
  - `FeatureFlag#SYSTEM` rows (table
    `dev-investor-bff-StateTable962DE04C-53QYFNIE3Q6B`), all 3 present:
    `confirmDecision: enabled=true`, `initiateDeposit: enabled=true`,
    `requestWithdrawal: enabled=true` (all `reason: null`).
  - Current live state shows no leaked/stuck condition at all — fully
    healed. Neither confirms nor refutes an intermittent leak; it only
    establishes the environment is not stuck right now.
- (4d) Statically confirmed `apps/e2e-feature-tests/src/account/
  circuit-breaker-lifecycle.e2e.test.ts` (scenario 14's file) traverses
  no Bedrock/advisory (AgentCore) hop. Given (4a)-(4c) already force the
  escalation branch below, the live-AWS solo run of scenario 14 was
  **not executed** this session — it would not change the decision, and
  skipping it avoids unnecessary live-AWS spend (cost-gate honored by
  omission, not by use).
- **Decision (per the session prompt's step-5 guard): evidence is
  ambiguous/contradictory relative to the Entry-28 hypothesis, not
  confined to `apps/e2e-feature-tests`.** The state-leak-via-
  re-emission mechanism is refuted (4a) and the fixture chain cannot
  even reach the breaker (4b). The only mechanism still consistent with
  every fact gathered across Entries 28 and this one — a stale
  `BROKER_CIRCUIT_OPEN` event from the ORIGINAL crashed run sitting
  in an at-least-once/reorderable queue and being delivered to
  `investor-bff`'s `broadcast-listener` AFTER the next test's
  `beforeEach` `resetFeatureFlags()` — is a queue-timing/redelivery
  question, not a test-isolation preflight a scoped
  `apps/e2e-feature-tests` fix can address; confirming it needs reading
  the actual queue/DLQ redrive behavior and possibly investor-bff's
  consumer idempotency, which is judgment work outside this session's
  scripted mandate. Per instruction, **STOPPING before any verdict or
  fix.** No engine fulfil, no code change, no ship. Not re-litigating
  the two already-blocked queued items; not expanding scope.
- No pre-existing whole-scope gate was hit (nothing shipped this
  session). No new backlog findings surfaced. No byte changed under
  `runtime/continuity/**`; no hook/settings edits; no Skills/Packs
  mutation; no SD-002 claim. Continuity-lab left untouched (HEAD
  unchanged `52c5b2e1`).
- Counters: WI 2/20 unchanged (item still selected+started, not
  completed — evidence-only session, handed to judgment); weeks 1/6
  unchanged; resumptions **5/15** (this entry's own resumption sample,
  confirmed at Entry 29). Recommended next operation: a fresh
  `claude-fable-5` session (per the workspace model policy — this is
  now confirmed hard judgment/debugging work, not scripted routing) to
  either (a) trace the investor-bff broadcast-listener queue/DLQ
  redelivery semantics and confirm or refute the stale-event-redelivery
  mechanism, or (b) determine the item is a service-side bug requiring
  a different, larger fix than originally scoped, and act accordingly
  within standing SD-001 rules.
  Week 1 runs through 2026-07-25T19:39:42Z; no weekly-boundary entry
  required this session.
