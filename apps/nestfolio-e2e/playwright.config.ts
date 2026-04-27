import { defineConfig, devices } from '@playwright/test';

const HOST_URL = 'http://localhost:4200';

const mfeServer = (app: string, port: number) => ({
  command: `pnpm nx run ${app}:serve-static`,
  url: `http://localhost:${port}`,
  reuseExistingServer: !process.env.CI,
  timeout: 120_000,
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
