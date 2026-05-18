---
id: nx-daemon-self-upgrade-pollutes-pnpm-lock
status: parking
type: bug
notes: "nx daemon respawn (triggered by nx-console / nx-mcp polling) runs `pnpm add -D nx@latest --ignore-scripts`, which scans the repo root, finds leaked tmp-* dirs, registers them as pnpm workspace importers in pnpm-lock.yaml. Every IDE/MCP poll = new pnpm-lock drift."
references:
  - package.json
  - pnpm-workspace.yaml
  - docs/backlog/jest-worker-scratch-leak-on-force-exit.md
  - docs/backlog/backlog-next-closing-phase-friction.md
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# Nx daemon self-upgrade pollutes pnpm-lock.yaml

## Surfacing

2026-05-19 e2e cleanup session. After the e2e suite + the eventbustrap fix shipped, the working tree had `pnpm-lock.yaml` drift (336 added lines) and ~191 leaked `tmp-*` dirs + ~191 leaked 20-hex dirs in repo root. `git restore pnpm-lock.yaml` would briefly succeed then the file would re-modify within seconds.

## Mechanism (observed)

1. WebStorm Nx Console plugin (`nxls/main.js`) and/or `nx-mcp --minimal` poll the workspace continuously.
2. Each poll spawns the Nx daemon (`nx/src/daemon/server/start.js`, currently `22.5.4`).
3. The daemon then spawns `pnpm add -D nx@latest --ignore-scripts` as a child — this appears to be an Nx self-upgrade attempt toward `nx@22.7.2`.
4. `pnpm add` scans the repo root, sees the leaked `tmp-*` dirs (each containing a `package.json` from a prior leak), treats them as workspace importers, and writes new entries into `pnpm-lock.yaml`:
   ```yaml
   tmp-91958-wWzG94ebLiZd:
     devDependencies:
       nx:
         specifier: ^22.7.2
   ```
5. Net effect: every IDE poll = lockfile drift + fresh tmp-* dirs (the daemon's plugin worker also scribbles `plugin*.sock` and `nx-native-file-cache-*/` into CWD instead of `$TMPDIR`).

## Why this is distinct from existing leakage backlogs

- `jest-worker-scratch-leak-on-force-exit` attributes `tmp-<pid>-<rand>/` to jest forceExit. **Today's leakers are spawned by Nx, not Jest** (the PIDs match the nx daemon's child, not jest-worker pool). So the upstream mutator family is broader than the existing backlog covers.
- `backlog-next-closing-phase-friction` A.2 covers `<20-hex>/` from Nx daemon socket-dir CWD fallback. The fix `NX_SOCKET_DIR=$TMPDIR` addresses sockets, NOT the `pnpm add` self-upgrade chain.

## Cheapest next step (when promoted)

1. Figure out which migration manifest or `nx.json` field tells the daemon to attempt `pnpm add -D nx@latest`. Disable / pin / clear it.
2. Add `'!tmp-*'` to `pnpm-workspace.yaml` exclusion patterns so even if Nx self-upgrades, pnpm won't register tmp-* dirs.
3. Optional: file an Nx issue — running `pnpm add` from inside the daemon during workspace polling is surprising and racy.

## Workaround until fixed

- Close WebStorm or stop `nx-mcp` before any `git status` / `git commit` flow that needs a clean working tree.
- `git restore pnpm-lock.yaml` immediately before commit (drift recurs but only on next IDE poll).
