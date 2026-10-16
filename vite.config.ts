import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: { chunkSizeWarningLimit: 700 },
  server: {
    // The Express server serves the single video with HTTP range support.
    fs: { deny: ['.env', '.env.*', '**/.git/**', '**/.data/**', '**/episode_mock.mp4'] },
  },
});
