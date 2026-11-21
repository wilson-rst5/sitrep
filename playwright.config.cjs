const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests/e2e',
  use: { baseURL: process.env.SITREP_TEST_URL || 'http://localhost:8080',
    viewport: { width: 1920, height: 1080 } },
});
