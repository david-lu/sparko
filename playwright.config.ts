import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser', outputDir: './test-results/browser', timeout: 90_000, workers: 1, fullyParallel: true,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [['line'], ['html', { open: 'never' }]] : 'list',
  use: { baseURL: 'http://127.0.0.1:3100', channel: 'chrome', viewport: { width: 1440, height: 1000 }, trace: 'retain-on-failure',
    // Use one software Vulkan backend for WebGPU, video textures, and compositing.
    // Selecting only a WebGPU adapter leaves Linux's compositor unable to share frames.
    launchOptions: { args: process.platform === 'linux' ? [
      '--enable-unsafe-webgpu', '--enable-unsafe-swiftshader', '--enable-features=Vulkan',
      '--use-angle=vulkan', '--use-vulkan=swiftshader', '--use-webgpu-adapter=swiftshader', '--disable-vulkan-surface',
    ] : [] },
  },
  webServer: {
    command: 'node node_modules/tsx/dist/cli.mjs server/index.ts', url: 'http://127.0.0.1:3100', reuseExistingServer: false, timeout: 30_000,
    // Tests own their server and mock providers; never inherit live account credentials.
    // A pulled Vercel environment must not turn the local entry point into a hosted server.
    env: { PORT: '3100', VERCEL: '1', SPARKO_TEST_MODE: '1', APP_PASSWORD: '', COMFY_CLOUD_API_KEY: '', COMFY_API_KEY: '', OPENAI_API_KEY: '',
      GEMINI_KEY: '', GEMINI_API_KEY: '', FAL_KEY: '', BLOB_READ_WRITE_TOKEN: '', DEFAULT_VIDEO_URL: '', DEFAULT_PROJECT_URL: '' },
  },
});
