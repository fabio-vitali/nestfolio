---
id: event-name-integrity
status: parking
type: epic
notes: "Event-name declarations have no integrity gate, so names drift from reality — declared-but-unwired dead constants AND cross-domain re-declarations that don't break on a producer rename. Theme epic, 3 members."
done_when: "An event-name integrity check exists so a declared event name cannot survive without a producer+consumer wiring AND cross-domain names are re-exported from the producer (a rename is a single-source compile/check error, not a silent stale literal); each in-scope name is wired, deleted, or re-exported. All members shipped or dropped."
scope: "Event-name correctness with no enforcing gate: (a) event-name constants declared in events.ts with no production emitter or consumer (dead/placeholder); (b) cross-domain adapter maps that RE-DECLARE a name via eventName('LITERAL') instead of RE-EXPORTING the producer's constant, so a producer rename silently breaks consumers with zero compile error."
out_of_scope:
  - "Missing emissions on a real functional path (e.g. broker-sim SIM_ORDER_REJECTED) — that is a flow gap, not a dead/drifting NAME"
  - "Event payload/subject typing — covered by the typed-subject program, not this name-integrity theme"
references: []
spec: null
plan: null
topic_memory: [project_event_subject_contracts.md]
validation_gate: null
---

# Event-name integrity

Root cause: there is no gate that ties a declared event-name constant to its production wiring or to its producer's own constant, so names drift from reality in two ways. (a) **Dead/unwired names** — a constant is declared in `events.ts` but has no production emitter and no consumer (placeholder or leftover from a refactor). (b) **Re-declared cross-domain names** — boundary adapters' `*CrossDomainEventTypes` maps re-declare each name as `eventName('LITERAL')` rather than re-exporting the producer's constant, so a producer rename leaves consumers subscribing to the stale literal (broken EB rule + dispatch) with zero compile error. The typed-subject program makes a producer *payload* change break consumer builds, but a *name* change does not. Fix pattern: an event-name registry / check-script that asserts every declared name is wired (producer+consumer) and that cross-domain names are re-exported from (or asserted equal to) the producer's literal.

Members (derived from `epic:` pointers):
- `account-closure-requested-never-emitted`
- `execution-ctrl-pause-resume-events-unwired`
- `adapter-event-name-redeclare-vs-reexport`
