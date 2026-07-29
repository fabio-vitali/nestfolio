# Declare the NODE_OPTIONS env block on the e2e-feature-tests test target

`apps/e2e-feature-tests/project.json` declares a `test-e2e-features` target whose
`options` carry a `command` and `color`, and **no `env` block**. The documented
convention for that target — the one `.claude/skills/audit-e2e-test/SKILL.md`
lists as a hard-fail check — is that it declares
`NODE_OPTIONS: --experimental-vm-modules`.

Add that env block to the `test-e2e-features` target's `options`, in the shape
the service `project.json` files already use, for example
`services/ledger/ledger-ctrl/project.json`:

```json
"env": {
  "NODE_OPTIONS": "--experimental-vm-modules"
}
```

**Change nothing else.** No other target, no other file, no rename, no
reordering of unrelated keys, and in particular **no edit to any file under
`tests/`** — the declared suite is what judges this work, and it is not yours to
change. You may read it.

The declared level-1 suite must pass afterwards, including its assertion about
this convention. Then stop.
