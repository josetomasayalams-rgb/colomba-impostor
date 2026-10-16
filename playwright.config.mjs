import { defineConfig } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const data = mkdtempSync(join(tmpdir(), 'colomba-browser-'));
export default defineConfig({
  testDir: './e2e', testIgnore: ['**/cloud-api.spec.mjs', '**/pages.spec.mjs'], fullyParallel: false, workers: 1, timeout: 90000,
  expect: { timeout: 10000 },
  use: { baseURL: 'http://127.0.0.1:4183', viewport: { width: 393, height: 852 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, actionTimeout: 10000, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  reporter: [['list'], ['json', { outputFile: 'evidence/e2e-results.json' }]],
  webServer: { command: 'node --disable-warning=ExperimentalWarning server/index.mjs', url: 'http://127.0.0.1:4183/api/health', reuseExistingServer: false, env: { PORT: '4183', COLOMBA_DB: join(data, 'game.sqlite') }, timeout: 15000 },
});
