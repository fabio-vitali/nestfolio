# Continuity Level 2 — Reusable Pack Composition

Continuity is active at **Level 2 of 6** when `activation.json` selects the
composed lock in `packs.lock.json`. The lock contains exactly:

- `nestfolio.level-1@1.0.1` with `nestfolio.backlog-next@1.0.1` and its exact
  19-asset behavior authority;
- `continuity.repository-tools@1.0.0` with the read-only
  `continuity.repository-status@1.0.0` Procedure.

Every selected manifest, Procedure specification, and executor asset is a
tracked local exact-version source with SHA-256 and byte-size identity. There
are no registries, remote sources, version ranges, overrides, network lookups,
or silent fallbacks.

Routine target entry points are the six `continuity:pack:*` and
`continuity:procedure:*` package scripts. Direct `/backlog-next` remains
available as current behavior; the retained Level 1 activation, lock, Procedure,
19 assets, and tests remain the exact rollback target.

Level 2 does not create or claim Work, Scope, Context Packs, Runs, Checkpoints,
Handoffs, Assurance, completion, Guards, Waivers, Decisions, Observations,
Lessons, learning promotion, a registry, or an external write authority.
