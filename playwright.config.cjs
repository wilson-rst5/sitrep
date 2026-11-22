const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests/e2e',
  expect: { timeout: 12000 },
  use: { baseURL: process.env.SITREP_TEST_URL || 'http://localhost:8080',
    launchOptions: { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
    viewport: { width: 1920, height: 1080 } },
});
