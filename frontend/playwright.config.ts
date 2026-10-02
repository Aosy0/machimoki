import { defineConfig, devices } from '@playwright/test'

/**
 * frontend の E2E テスト設定。
 *
 * - webServer は frontend の Vite dev サーバー（cwd は本設定ファイルのある frontend）。
 * - 検索APIは各テストの beforeEach で page.route() によりモックするため、
 *   api サーバー（core, port 3000）は不要。
 * - ブラウザは Chromium のみ。
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  timeout: 30_000,
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
