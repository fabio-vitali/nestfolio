---
id: host-runtime-config-json-regeneration-silently-optional
status: parking
type: bug
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
notes: "Two latent bugs: deploy.sh skips config regen + build doesn't copy file."
---

# Host runtime `config.json` regeneration is silently optional

`apps/nestfolio-host/public/assets/config.json` carries the deployed BFF AppSync URLs, Cognito pool IDs, etc. Two latent bugs surfaced during Spec 5 e2e validation: (1) `infrastructure/scripts/deploy.sh` does not re-run `pnpm nx run nestfolio-host:config --prefix=<prefix>` after BFF redeploys, so a fresh deploy can leave the file pointing at stale URLs; (2) `nestfolio-host:build` does not copy the file from `apps/nestfolio-host/public/assets/` into `dist/apps/nestfolio-host/browser/assets/`, so even when config IS regenerated, the served bundle keeps the old one. Failure mode: shell loads `/assets/config.json` → gets the SPA `index.html` (404 fallback) → `JSON.parse('<!doctype...')` → "Federation init failed" → page renders empty `<generic>Failed to load application</generic>`. Two fixes needed (deploy hook + build asset wiring).
