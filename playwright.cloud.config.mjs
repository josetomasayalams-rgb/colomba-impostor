import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './e2e', testIgnore: '**/pages.spec.mjs', grepInvert: /real server restart/, fullyParallel: false, workers: 1, timeout: 120000,
  expect: { timeout: 15000 },
  use: { baseURL: process.env.COLOMBA_TEST_URL || 'http://127.0.0.1:4184', viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true, actionTimeout: 15000, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  reporter: [['list'], ['json', { outputFile: 'evidence/cloud-results.json' }]],
  webServer: process.env.COLOMBA_CLOUD_MANAGED === '1' ? { command: 'node node_modules/wrangler/bin/wrangler.js dev --ip 127.0.0.1 --port 4184 --inspector-port 0 --local', url: 'http://127.0.0.1:4184/api/health', reuseExistingServer: false, timeout: 30000 } : undefined,
});
