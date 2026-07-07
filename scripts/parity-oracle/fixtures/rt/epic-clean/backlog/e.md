---
id: e
type: epic
status: active
done_when: all core members shipped
---

# e — demo delivery epic (runtime orchestrator parity twin)

A minimal active delivery epic with two open core members, used by the WS-4 parity twins
(`rt-epic-ship-clean`, `rt-epic-auto-no-self-merge`) to drive `run-epic.mjs` end-to-end:
the spine drives each open core member inline (each parks on `execute:<member>`), then stops
at the merge floor park. The epic is never auto-merged.
