import { defineConfig } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const storage = mkdtempSync(join(tmpdir(), 'colomba-pages-'));
export default defineConfig({
  testDir: './e2e', testMatch: '**/pages.spec.mjs', fullyParallel: false, workers: 1, timeout: 120000,
  expect: { timeout: 15000 },
  use: { baseURL: process.env.COLOMBA_PAGES_URL || 'http://127.0.0.1:4187/colomba-impostor/', viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true, actionTimeout: 15000, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  reporter: [['list'], ['json', { outputFile: process.env.COLOMBA_PAGES_URL ? 'evidence/pages-production-results.json' : 'evidence/pages-results.json' }]],
  webServer: process.env.COLOMBA_PAGES_URL ? undefined : [
    { command: 'node scripts/preview-pages.mjs', url: 'http://127.0.0.1:4187/colomba-impostor/', timeout: 15000, reuseExistingServer: false },
    { command: 'node node_modules/wrangler/bin/wrangler.js d1 migrations apply DB --local --persist-to "$COLOMBA_TEST_STORAGE" && node node_modules/wrangler/bin/wrangler.js dev --ip 127.0.0.1 --port 4184 --inspector-port 0 --local --persist-to "$COLOMBA_TEST_STORAGE"', env: { COLOMBA_TEST_STORAGE: storage }, url: 'http://127.0.0.1:4184/api/health', timeout: 30000, reuseExistingServer: false },
  ],
});
