# A1 — CSP single-source of truth (design)

**Status:** Proposed
**Author:** fabio-vitali + Claude
**Date:** 2026-04-24
**Parent charter:** [`2026-04-24-mfe-architecture-charter.md`](./2026-04-24-mfe-architecture-charter.md) (Pillar 5, §5 row 8)
**Parent roadmap:** [`../plans/2026-04-24-mfe-charter-migration-roadmap.md`](../plans/2026-04-24-mfe-charter-migration-roadmap.md) — item A1
**Informational predecessor:** [`2026-04-23-shell-render-restoration-design.md`](./2026-04-23-shell-render-restoration-design.md) §2 (CSP strategy)

## 1. Problem

Today the CSP string lives in two places that disagree:

- `apps/nestfolio-host/src/index.html:10` — full directive set (default-src, script-src, style-src, font-src, img-src, connect-src, frame-ancestors, base-uri, form-action).
- `services/investor/investor-web/src/service.stack.ts:103` — three directives only (`default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'`).

Whichever is stricter wins at the browser; violations against the looser one are silent. This is one of the bug classes the MFE charter was written to prevent (charter §2 "discovery via convention rather than declaration"). Pillar 5 mandates one canonical file that both consumers read from.

## 2. Scope

This spec covers the *mechanism* only: a canonical file, build-time substitution into `index.html`, CDK `readFileSync` at synth time, and Nx dependency wiring so `nx affected` picks up changes.

**Out of scope (deferred to later items in the migration roadmap):**
- Post-build `scripts/assert-shell-html.mjs` regression gate → **B2** (render-restoration §5 mechanism).
- Shrinking `connect-src` to `'self'` → **B1/B3** (unified CloudFront topology + Apollo per-MFE relative URLs).
- Runtime-config factory refactor (`provideAuth` AUTH_CONFIG DI token) → **A4**.
- `BucketDeployment` removal + per-app `deploy` targets → **B4**.

## 3. Decisions (locked)

### 3.1 Build-time substitution (not runtime)

A tracked template `apps/nestfolio-host/src/index.html.tmpl` contains a `{{CSP}}` placeholder. A new script `scripts/emit-index-html.mjs` reads the template + `csp.txt`, substitutes the placeholder, writes `apps/nestfolio-host/src/index.html` (which becomes gitignored). The existing `src/index.html` is renamed to `.tmpl` and its CSP meta tag's `content` attribute is replaced with `{{CSP}}`.

Rationale: matches shell-render-restoration §2.1. Runtime injection would require a CloudFront Function (overkill for a single string) or SSR (not applicable to Angular static-site deploy). Build-time keeps the tooling surface to ~25 lines of Node.

### 3.2 Include the sha256 hash in `csp.txt` from day one

Native Federation's post-build injects exactly `<script type="esms-options">{"shimMode":true}</script>` (verified at `node_modules/.pnpm/@angular-architects+native-federation@21.2.1/.../src/utils/updateIndexHtml.js:29-36`). The body is deterministic as long as no `esmsInitOptions` is passed to the build target. Today's configuration passes none.

Computed once: `printf '%s' '{"shimMode":true}' | openssl dgst -sha256 -binary | openssl base64` → `NxFByHVehWCRp13zII+PkyEbL0FVXOumU3tgjZaLf9U=`.

Rationale: includes costs 2 lines today; aligns Pillar 5's "no `unsafe-inline`, inline scripts sha256-hashed" invariant from the start; frees B2 to add only the post-build assertion without the second concern of "what hash should we use." If a future B2 step adds `esmsInitOptions`, both the hash + csp.txt change together in one commit, caught by the build-time assertion.

### 3.3 Plain-text file (`csp.txt`), not a TypeScript constant

Rationale: the CDK stack and Angular build operate under different tsconfig/module graphs. A TS re-export is possible but brittle across workspaces. A text file is trivially read by both (`fs.readFileSync`), discoverable on disk, version-controlled cleanly. Shell-render-restoration §2.1 already landed on this choice — repeating it here for symmetry.

### 3.4 `connect-src` includes AppSync + Cognito for now

Pillar 5 + charter §7 R6 ultimately require `connect-src 'self'` (same-origin everything). That depends on Phase B — `B1` migrating to the unified CloudFront topology, `B3` refactoring Apollo clients to use `/graphql/<domain>` + `/realtime/<domain>` relative paths. Until then, the shell still makes direct HTTPS/WSS calls to AppSync and direct Cognito calls. The current `connect-src` must continue to admit them or the deployed shell breaks.

Included now:
- `https://*.amazonaws.com`
- `https://*.appsync-api.*.amazonaws.com`
- `wss://*.appsync-realtime-api.*.amazonaws.com`
- `https://cognito-idp.us-east-1.amazonaws.com`
- `https://cognito-identity.us-east-1.amazonaws.com`

Phase B shrinks `connect-src` to `'self'` via a single-line edit to `csp.txt`.

## 4. File layout

### 4.1 New files

**`apps/nestfolio-host/csp.txt`** — one line, no trailing newline, no trailing `;`:

```
default-src 'self'; script-src 'self' 'sha256-NxFByHVehWCRp13zII+PkyEbL0FVXOumU3tgjZaLf9U='; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self' https://*.amazonaws.com https://*.appsync-api.*.amazonaws.com wss://*.appsync-realtime-api.*.amazonaws.com https://cognito-idp.us-east-1.amazonaws.com https://cognito-identity.us-east-1.amazonaws.com; worker-src 'self' blob:; manifest-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'
```

**`apps/nestfolio-host/src/index.html.tmpl`** — identical to current `apps/nestfolio-host/src/index.html` except line 10's `content="..."` becomes `content="{{CSP}}"`.

**`scripts/emit-index-html.mjs`** — ~25 lines of Node (stdlib `fs` + `path`). Behaviour:

```text
Usage: node scripts/emit-index-html.mjs <template> <csp-file> <output>
```

Logic:
1. Read `<template>` (fail with exit 1 + message if missing).
2. Read `<csp-file>`, trim trailing whitespace (fail if missing or empty).
3. Assert template contains exactly one `{{CSP}}` placeholder (fail if 0 or >1).
4. Substitute, write to `<output>` atomically (write to `<output>.tmp`, rename).

Invoked at the workspace root with:

```
node scripts/emit-index-html.mjs \
  apps/nestfolio-host/src/index.html.tmpl \
  apps/nestfolio-host/csp.txt \
  apps/nestfolio-host/src/index.html
```

### 4.2 Deleted files

**`apps/nestfolio-host/src/index.html`** — removed from git (renamed to `.tmpl` above) and added to `.gitignore` to prevent accidental commits of the emitted output.

### 4.3 Modified files

**`apps/nestfolio-host/project.json`** — add a `prepare-index` target and chain it before `esbuild`:

```json
"prepare-index": {
  "executor": "nx:run-commands",
  "inputs": [
    "{projectRoot}/src/index.html.tmpl",
    "{projectRoot}/csp.txt"
  ],
  "outputs": ["{projectRoot}/src/index.html"],
  "options": {
    "cwd": "{workspaceRoot}",
    "commands": [
      "node scripts/emit-index-html.mjs apps/nestfolio-host/src/index.html.tmpl apps/nestfolio-host/csp.txt apps/nestfolio-host/src/index.html"
    ]
  }
},
"esbuild": {
  "executor": "@angular-devkit/build-angular:application",
  "dependsOn": ["prepare-index"],
  ...
}
```

Named-input `default` on `esbuild` already picks up `{projectRoot}/src/**` so no inputs edit needed on that target — the `dependsOn` ensures `prepare-index` runs first and its declared `outputs` fold into the fingerprint.

Rationale:
- Separate `prepare-index` target keeps esbuild options unchanged; easy to invoke standalone (`pnpm nx run nestfolio-host:prepare-index`) for debugging.
- `inputs: [...]` on `prepare-index` tells Nx's input fingerprinter to re-run when either source changes.
- Adding `apps/nestfolio-host/src/index.html` to `esbuild.inputs` is redundant (Angular's application builder reads it via the `index` option and will notice the mtime change), but the explicit input makes the dependency graph obvious to `nx graph` readers. Include it.

**`services/investor/investor-web/src/service.stack.ts`** — line 103:

```ts
// Before:
contentSecurityPolicy: "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'",

// After:
contentSecurityPolicy: readFileSync(
  join(__dirname, '../../../../apps/nestfolio-host/csp.txt'),
  'utf-8',
).trim(),
```

The `readFileSync` + `join` imports already exist (`service.stack.ts:21-22`). Path depth: `services/investor/investor-web/src/` → four `..` → workspace root → `apps/nestfolio-host/csp.txt`. The existing `cf-functions/copilot-rewrite.js` uses the same 1-level-up `__dirname` pattern (`readFileSync(join(__dirname, 'cf-functions', 'copilot-rewrite.js'))`), so the four-level-up pattern is a net-new path — it resolves at synth-time, not runtime, so no packaging concern.

**`services/investor/investor-web/project.json`** — add the CSP file to the `synth` target's `inputs` so `nx affected` re-synths when `csp.txt` changes:

```json
"synth": {
  ...
  "inputs": ["default", "^production", "{workspaceRoot}/apps/nestfolio-host/csp.txt"],
  ...
}
```

Rationale: target-level inputs is the surgical choice. A project-level `implicitDependencies: ["nestfolio-host"]` would couple investor-web's re-synth to every shell change (CSS, TS, assets) — excessive. Target-level inputs only re-synth when `csp.txt` itself changes. If the current `synth` target has no explicit `inputs` array, add the full list (`default`, `^production`, `{workspaceRoot}/apps/nestfolio-host/csp.txt`) so we don't silently drop Nx's defaults.

**`.gitignore`** — add:

```
# CSP single-source-of-truth — emitted from src/index.html.tmpl + csp.txt
apps/nestfolio-host/src/index.html
```

## 5. Interaction with existing tooling

### 5.1 Native Federation build

The shell's `build` target is `@angular-architects/native-federation:build` which wraps `esbuild` as a sub-target. After `esbuild` emits `dist/apps/nestfolio-host/browser/index.html` (with the substituted CSP already baked in from `src/index.html`), NF's post-build runs `updateScriptTags` which rewrites the `polyfills`/`main` script tags and injects `<script type="esms-options">{"shimMode":true}</script>`. That inline script is the one whose hash is already in `csp.txt`. Flow: `prepare-index` → `esbuild` (reads emitted `src/index.html`, copies to dist) → NF post-build (mutates dist copy). No step touches a copy that would surprise another step.

### 5.2 `nx serve` / `nx serve-static`

Both pass through the `build` target chain (`serve` uses `@angular-architects/native-federation:build` under the hood with `dev: true`; `serve-static` uses the built artefacts). Adding `prepare-index` via `dependsOn` guarantees the emitted `src/index.html` exists before the dev-server reads it. Verified by inspecting the existing `serve` target at `apps/nestfolio-host/project.json:81-89` — it targets `nestfolio-host:serve-original:development` which targets `nestfolio-host:esbuild:development`. The `dependsOn` on `esbuild` cascades up.

### 5.3 CDK synth

`readFileSync` runs at synth time (Node process invoked by `cdk synth`). No packaging implications — the CSP string is materialized into the synthesized CloudFormation template as a literal. Tokenization is unnecessary and would break the `ResponseHeadersPolicy`'s static-string property type.

### 5.4 CDK build target

The `pnpm nx run investor-web:build` target (compiles the CDK app TypeScript) does not consult `csp.txt`. Only `synth` / `deploy` do. The `implicitDependencies: ["nestfolio-host"]` marker is what ties them together at the `affected` level.

## 6. Verification order

Applied in this order, each step produces a distinct pass signal:

1. **Create `csp.txt`** with the full content from §4.1. Commit with `src/index.html` still in place. No behavioural change yet — this step just lands the file.
2. **Rename `src/index.html` → `src/index.html.tmpl`, add `{{CSP}}` placeholder, add to `.gitignore`, add `scripts/emit-index-html.mjs`, wire `prepare-index` target.** Run `pnpm nx run nestfolio-host:prepare-index` — expect `src/index.html` to materialize with the substituted CSP. Run `pnpm nx build nestfolio-host` — expect `dist/apps/nestfolio-host/browser/index.html` to contain the substituted CSP verbatim.
3. **Update `service.stack.ts` to `readFileSync(csp.txt)`, add `implicitDependencies` to investor-web's `project.json`.** Run `pnpm nx run investor-web:synth --prefix=dev` (or the local equivalent) — expect the synthesized CloudFormation to contain the full CSP from `csp.txt` in the `ResponseHeadersPolicy` config.
4. **Drift test.** Append a trivial change to `csp.txt` (e.g., add a space in one of the URLs). Run `pnpm nx affected -t build,synth --base=HEAD~1` — expect both `nestfolio-host:build` and `investor-web:synth` to re-run. Revert the change.
5. **Placeholder-missing test.** Temporarily remove the `{{CSP}}` placeholder from `src/index.html.tmpl`, run `pnpm nx run nestfolio-host:prepare-index` — expect non-zero exit with a clear error message. Revert.

## 7. Success criteria

- `apps/nestfolio-host/csp.txt` exists, one non-empty line, matches §4.1 verbatim.
- `pnpm nx build nestfolio-host` produces `dist/apps/nestfolio-host/browser/index.html` whose `<meta http-equiv="Content-Security-Policy">` content equals `csp.txt` verbatim.
- `pnpm nx run investor-web:synth` produces a CFN template whose `ResponseHeadersPolicy.Properties.ResponseHeadersPolicyConfig.SecurityHeadersConfig.ContentSecurityPolicy.ContentSecurityPolicy` equals `csp.txt` verbatim.
- `pnpm nx affected -t build,synth` re-runs both targets when `csp.txt` changes.
- `node scripts/emit-index-html.mjs` fails clearly when any input is missing or when the `{{CSP}}` placeholder is absent or duplicated.
- `git status` after `pnpm nx build nestfolio-host` shows no untracked `apps/nestfolio-host/src/index.html` (confirmed gitignored).

## 8. Risks

- **IDE surprise (WebStorm).** A gitignored `src/index.html` is still visible in the IDE, labelled as ignored. Unlikely to cause confusion (shell-render-restoration already committed to this pattern).
- **Stale emitted `src/index.html` during `nx serve`.** If a developer manually edits `src/index.html` (the emitted file), the edit vanishes on next `prepare-index` run. Mitigated by: the file header line emitted by `emit-index-html.mjs` will include a `<!-- Generated from index.html.tmpl + csp.txt. DO NOT EDIT. -->` comment as the second line of the file.
- **Concurrent Nx tasks.** Two parallel runs of `prepare-index` (e.g., `nx run-many -p nestfolio-host --target=build,serve`) could race on the write. Atomic write (`<output>.tmp` + rename) mitigates; Nx target caching means only one run typically executes.
- **CDK bundling.** `BucketDeployment` in `service.stack.ts` still exists today (removed in B4). It Docker-bundles `dist/apps/nestfolio-host/browser` and references the emitted (not template) index.html. No interaction with csp.txt; noted for completeness.

## 9. Out of scope (restated)

- `scripts/assert-shell-html.mjs` regression gate → B2.
- `connect-src 'self'` shrink → B1/B3.
- `provideAuth` factory refactor → A4.
- `BucketDeployment` removal + per-app `deploy` targets → B4.
- Updating `docs/superpowers/plans/2026-04-24-mfe-charter-migration-roadmap.md`.
- Native Federation v4 migration.

## 10. References

### This workspace

- `docs/superpowers/specs/2026-04-24-mfe-architecture-charter.md` — Pillar 5, §5 row 8.
- `docs/superpowers/plans/2026-04-24-mfe-charter-migration-roadmap.md` — A1 scope + open questions.
- `docs/superpowers/specs/2026-04-23-shell-render-restoration-design.md` §2 — prior CSP design (informational).
- `apps/nestfolio-host/src/index.html` — current source of the meta-tag CSP.
- `services/investor/investor-web/src/service.stack.ts:100-118` — current source of the CDK CSP.

### External

- `node_modules/.pnpm/@angular-architects+native-federation@21.2.1/.../src/utils/updateIndexHtml.js:29-40` — proves the inline `esms-options` body is `JSON.stringify({shimMode: true, ...nfOptions.esmsInitOptions})` (deterministic today).
