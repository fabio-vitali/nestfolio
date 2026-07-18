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
