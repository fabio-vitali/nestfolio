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
