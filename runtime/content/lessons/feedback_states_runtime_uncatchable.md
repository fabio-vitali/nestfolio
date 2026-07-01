---
name: SF States.Runtime is uncatchable
description: SF States.Runtime is NOT catchable; a Catch/Retry on it silently
  never fires — only a synthetic SF execution with the bad input confirms catch
  logic
type: feedback
mints:
  - check: no-states-runtime-catch
    ratified: 2026-07-01T16:17:05.236Z
    status: active
---
Step Functions States.Runtime errors are not catchable (per AWS docs). A Catch listing States.Runtime synthesizes and deploys but silently never fires. Only a synthetic SF execution with the bad input proves catch logic. (In-repo ring-2 mirror.)
