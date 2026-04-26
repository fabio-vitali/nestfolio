# Probes

Throwaway scripts that exercise deployed environments.

## `cf-smoke.mjs`

CloudFront route smoke probe. Walks the 5 MFE routes (`/investor`,
`/advisory`, `/ledger`, `/dashboard`, `/onboarding`) and asserts each renders
without console errors or failed charter-path requests.

```bash
pnpm cf-smoke --prefix=dev
# or
node tools/probes/cf-smoke.mjs --prefix=dev --region=us-east-1
```

Requires Leapp credentials (reads SSM
`/nestfolio/<prefix>-investor/web/distributionUrl`) and the
chromium-headless-shell Playwright binary
(install with `npx --yes playwright install chromium-headless-shell` —
the binary lives in `~/Library/Caches/ms-playwright/` on macOS and is
not committed). Note: the workspace declares only `playwright-core`;
`npx playwright` fetches the install CLI on demand without adding to
devDependencies.

This probe is the C1 charter graduation gate. When the full
`apps/nestfolio-e2e/` Playwright harness lands (resumption of
`docs/superpowers/plans/2026-04-22-playwright-e2e-ui.md` Phase 2–10), this
probe is removed — the harness's own boot-time check supersedes it.
