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
