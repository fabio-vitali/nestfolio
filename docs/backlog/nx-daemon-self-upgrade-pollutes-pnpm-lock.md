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

Apply in order; each layer holds even if the next layer regresses. None of these are committed yet — pick before opening a worktree.

### 1. Pin nx so the daemon stops resolving `nx@latest`

```jsonc
// nx.json
{
  "installation": { "version": "22.5.4" }
}
```

The daemon's child `pnpm add -D nx@latest --ignore-scripts` is what introduces the `^22.7.2` specifier into `pnpm-lock.yaml` for every leaked `tmp-*`. Pinning the installation version is the most direct upstream fix — if the daemon believes nx is already at the pinned version, the self-upgrade attempt should short-circuit.

### 2. Defense-in-depth — exclude `tmp-*` from the workspace

```yaml
# pnpm-workspace.yaml
packages:
  - 'services/**'
  - 'libs/*'
  - 'tools/*'
  - 'apps/*'
  - '!tmp-*'
  - '!**/tmp-*'
```

[pnpm-workspace.yaml docs](https://pnpm.io/pnpm-workspace_yaml) confirm negative patterns work. Quote them — bare `!` at start of a YAML scalar is reserved. With this, even if the daemon's self-upgrade still fires, pnpm will refuse to register `tmp-*` dirs as importers, so the lockfile stays clean.

### 3. Make WebStorm see `NX_DAEMON_SOCKET_DIR`

The socket-in-CWD leak (`<20-hex>/` dirs, `plugin*.sock`) was fixed upstream in nx core via [nrwl/nx#23348](https://github.com/nrwl/nx/pull/23348) (closing [nrwl/nx-console#2114](https://github.com/nrwl/nx-console/issues/2114)), so `NX_DAEMON_SOCKET_DIR=$TMPDIR` is honoured on `nx@22.5.4`. **The catch:** WebStorm doesn't inherit shell env. Set it process-wide on macOS so both WebStorm and `nx-mcp` see it:

```bash
launchctl setenv NX_DAEMON_SOCKET_DIR "$TMPDIR"
# Then restart WebStorm.
```

### 4. Optional — file upstream

The daemon running `pnpm add -D nx@latest --ignore-scripts` autonomously during IDE polling is surprising and racy with concurrent pnpm operations. Closest existing tickets ([nrwl/nx#28991](https://github.com/nrwl/nx/issues/28991), [nrwl/nx#21492](https://github.com/nrwl/nx/issues/21492), [nrwl/nx#23031](https://github.com/nrwl/nx/issues/23031)) don't match exactly. If steps 1-3 don't suppress it, capture parent-process evidence (`pstree` or `lsof` on the spawned pnpm pid) and file a fresh Nx issue.

## Related research (2026-05-19)

- [nrwl/nx-console#2114](https://github.com/nrwl/nx-console/issues/2114) — closed via [nrwl/nx#23348](https://github.com/nrwl/nx/pull/23348). Socket-dir env var is honoured; WebStorm just doesn't see shell env.
- [nrwl/nx#34742](https://github.com/nrwl/nx/issues/34742) — pnpm-lock changes cascade through Nx's affected graph (orthogonal effect of the lockfile drift).
- [nrwl/nx-console#1288](https://github.com/nrwl/nx-console/issues/1288), [nrwl/nx-console#1886](https://github.com/nrwl/nx-console/issues/1886), [nrwl/nx#19831](https://github.com/nrwl/nx/issues/19831) — broader nx-console ↔ pnpm friction context.
- [pnpm/pnpm#3561](https://github.com/pnpm/pnpm/issues/3561) — confirms exclude semantics for workspace negation.

## Workaround until fixed

- Close WebStorm or stop `nx-mcp` before any `git status` / `git commit` flow that needs a clean working tree.
- `git restore pnpm-lock.yaml` immediately before commit (drift recurs but only on next IDE poll).
