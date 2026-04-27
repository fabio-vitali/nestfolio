import { defineConfig, devices } from '@playwright/test';

const HOST_URL = 'http://localhost:4200';

// Serve directly from dist/ via http-server. The Nx `e2e` target's `dependsOn`
// pre-builds all six MFEs sequentially with `nf-build:production` so dist is
// guaranteed up-to-date by the time Playwright launches these processes. We
// avoid invoking `nx run X:serve-static` because @nx/web:file-server triggers
// a parallel build on each spawn, which races on the federation manifest cache
// and intermittently fails with "@angular/animations not found in package.json".
// SPA fallback: --proxy http://localhost:${port}? routes 404s back to /index.html
// so deep-links like /onboarding work under Angular's client-side router.
const mfeServer = (app: string, port: number) => ({
  command: `pnpm exec http-server dist/apps/${app}/browser -p ${port} -s --cors -c-1 --proxy http://localhost:${port}?`,
  url: `http://localhost:${port}`,
  reuseExistingServer: !process.env.CI,
  timeout: 60_000,
  stdout: 'pipe' as const,
  stderr: 'pipe' as const,
});

export default defineConfig({
  testDir: './src',
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI
    ? [
        ['list'],
        ['html', { open: 'never', outputFolder: 'reports/html' }],
        ['junit', { outputFile: 'reports/junit.xml' }],
      ]
    : 'list',
  timeout: 600_000,
  expect: { timeout: 30_000 },
  use: {
    baseURL: HOST_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 15_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    mfeServer('nestfolio-host', 4200),
    mfeServer('investor-mfe', 4201),
    mfeServer('dashboard-mfe', 4202),
    mfeServer('advisory-mfe', 4203),
    mfeServer('ledger-mfe', 4204),
    mfeServer('onboarding-mfe', 4205),
  ],
  outputDir: 'test-results',
});
