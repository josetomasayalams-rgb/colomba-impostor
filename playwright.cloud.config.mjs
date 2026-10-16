import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './e2e', grepInvert: /real server restart/, fullyParallel: false, workers: 1, timeout: 120000,
  expect: { timeout: 15000 },
  use: { baseURL: process.env.COLOMBA_TEST_URL || 'http://127.0.0.1:4184', viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true, actionTimeout: 15000, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  reporter: [['list'], ['json', { outputFile: 'evidence/cloud-results.json' }]],
});
