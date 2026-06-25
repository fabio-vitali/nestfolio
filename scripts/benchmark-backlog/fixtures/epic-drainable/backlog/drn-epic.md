---
id: drn-epic
status: parking
type: epic
notes: "Parking epic whose every core member is already shipped — immediately drainable once promoted."
done_when: "Both drn core members are shipped (they already are)."
scope: "The drn surface: two already-shipped tasks awaiting epic closure."
out_of_scope:
  - Any work beyond the two drn tasks.
  - Any real deploy or e2e run — this fixture exists solely for sandbox tests.
references: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# Epic: Drn (drainable)

Parking theme epic with two core members, both already shipped. Promoting it lets the
close ritual run immediately: rule 9 is already satisfied (no non-terminal members), so
it is drainable on promotion.
