import { defineConfig, devices } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

const HOST_URL = 'http://localhost:4200';
// Spawn webServer commands from the workspace root so `dist/...` and
// `apps/nestfolio-e2e/tools/...` resolve correctly. Playwright's default
// cwd is the directory containing this config file.
const WORKSPACE_ROOT = resolve(__dirname, '../..');

// Resolve dev CloudFront URL once and forward `/graphql/*` + `/realtime/*`
// from the host webServer to it. Without the proxy those relative paths
// (the production same-origin contract — Charter §7 R6, see
// libs/shell/src/graphql/create-apollo-client.ts) fall through to the SPA
// index.html and the browser hits "Unexpected token '<'" on every Apollo
// query/mutation/subscription. Only port 4200 (host) needs the proxy —
// the MFE bundle servers on 4201–4205 don't see API traffic.
const PREFIX = process.env.NESTFOLIO_INTEG_PREFIX ?? 'dev';
const REGION = process.env.AWS_REGION ?? 'us-east-1';
const PROXY_TARGET = (() => {
  if (process.env.NF_E2E_PROXY_TARGET) return process.env.NF_E2E_PROXY_TARGET;
  try {
    return execFileSync('aws', [
      'ssm', 'get-parameter',
      '--region', REGION,
      '--name', `/nestfolio/${PREFIX}-investor/web/distributionUrl`,
      '--query', 'Parameter.Value',
      '--output', 'text',
    ], { encoding: 'utf8' }).trim();
  } catch (err) {
    console.warn(`[playwright.config] could not resolve CloudFront URL via SSM (${(err as Error).message}); /graphql proxy disabled`);
    return '';
  }
})();

const mfeServer = (app: string, port: number) => ({
  command: `node apps/nestfolio-e2e/tools/serve-mfe.mjs dist/apps/${app}/browser ${port}`,
  cwd: WORKSPACE_ROOT,
  url: `http://localhost:${port}`,
  reuseExistingServer: !process.env.CI,
  timeout: 60_000,
  stdout: 'pipe' as const,
  stderr: 'pipe' as const,
  env: {
    ...(process.env as Record<string, string>),
    NF_E2E_PROXY_TARGET: port === 4200 ? PROXY_TARGET : '',
  },
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
