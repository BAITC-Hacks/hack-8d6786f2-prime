const { defineConfig } = require('../frontend/node_modules/@playwright/test')

module.exports = defineConfig({
  testDir: '../frontend/tests',
  testMatch: 'platform.spec.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  reporter: 'list',
  outputDir: process.env.QA_BROWSER_OUTPUT || '../frontend/test-results/platform',
  use: {
    baseURL: process.env.QA_FRONTEND_URL || 'http://127.0.0.1:5174',
    channel: process.env.PLAYWRIGHT_CHANNEL || (process.platform === 'win32' ? 'msedge' : undefined),
    viewport: { width: 1440, height: 1100 },
    locale: 'ru-RU',
    trace: 'retain-on-failure',
  },
})
