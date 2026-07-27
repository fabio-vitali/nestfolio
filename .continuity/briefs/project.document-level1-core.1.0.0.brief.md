# Document the level-1 core module

Add a short JSDoc comment above each exported **function** in
`continuity/level-1/src/core.mjs`: `stableJson`, `sha256Text`, `guaranteeCard`
and `assertNoForbiddenClaim`. One or two sentences each, saying what the
function returns or what it throws.

Change no behaviour. No renames, no signature changes, no new or removed
exports, and no edits to any other file — in particular nothing under
`.claude/skills/backlog-next/`, whose bytes are locked by digest.

The declared level-1 suite must still pass unchanged. Then stop.
