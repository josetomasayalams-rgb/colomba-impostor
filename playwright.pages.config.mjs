import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './e2e', testMatch: '**/pages.spec.mjs', fullyParallel: false, workers: 1, timeout: 120000,
  expect: { timeout: 15000 },
  use: { baseURL: 'http://127.0.0.1:4187/colomba-impostor/', viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true, actionTimeout: 15000, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  reporter: [['list'], ['json', { outputFile: 'evidence/pages-results.json' }]],
  webServer: [
    { command: 'node scripts/preview-pages.mjs', url: 'http://127.0.0.1:4187/colomba-impostor/', timeout: 15000, reuseExistingServer: false },
    { command: 'node node_modules/wrangler/bin/wrangler.js dev --ip 127.0.0.1 --port 4184 --inspector-port 0 --local', url: 'http://127.0.0.1:4184/api/health', timeout: 30000, reuseExistingServer: false },
  ],
});
