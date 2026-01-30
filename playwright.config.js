// @ts-check
const { defineConfig, devices } = require('@playwright/test');

/**
 * Anonimizator v3 - Playwright Configuration
 */
module.exports = defineConfig({
    testDir: './tests',
    fullyParallel: false, // Run tests sequentially for consistent state
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 0,
    workers: 1,
    reporter: [
        ['html', { outputFolder: 'playwright-report' }],
        ['list']
    ],

    use: {
        baseURL: 'http://localhost:5173',
        trace: 'on-first-retry',
        screenshot: 'only-on-failure',
        video: 'retain-on-failure',
    },

    projects: [
        {
            name: 'chromium',
            use: { ...devices['Desktop Chrome'] },
        },
    ],

    /* Run local dev server before tests */
    webServer: {
        command: 'docker-compose up -d && sleep 5',
        url: 'http://localhost:5173',
        reuseExistingServer: true,
        timeout: 120 * 1000,
    },
});
