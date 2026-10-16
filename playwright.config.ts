import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser', timeout: 90_000, workers: 1, fullyParallel: false,
  use: { baseURL: 'http://127.0.0.1:3000', channel: 'chrome', viewport: { width: 1440, height: 1000 }, trace: 'retain-on-failure' },
  webServer: { command: 'node node_modules/tsx/dist/cli.mjs server/index.ts', url: 'http://127.0.0.1:3000', reuseExistingServer: true, timeout: 30_000 },
});
