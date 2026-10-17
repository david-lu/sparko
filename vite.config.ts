import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import { AI_MODELS } from './shared/constants.ts';

export default defineConfig({
  optimizeDeps: { include: ['@zip.js/zip.js', 'zod'] },
  plugins: [react(), viteStaticCopy({ targets: [
    { src: 'node_modules/@ricky0123/vad-web/dist/vad.worklet.bundle.min.js', dest: 'voice-assets', rename: { stripBase: true } },
    { src: `node_modules/@ricky0123/vad-web/dist/silero_vad_${AI_MODELS.voiceActivity}.onnx`, dest: 'voice-assets', rename: { stripBase: true } },
    { src: 'node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.{mjs,wasm}', dest: 'voice-assets', rename: { stripBase: true } },
  ] })],
  build: { chunkSizeWarningLimit: 700 },
  server: {
    // The Express server serves the single video with HTTP range support.
    fs: { deny: ['.env', '.env.*', '**/.git/**', '**/.data/**', '**/episode_mock.mp4', '**/sample.mp4'] },
  },
});
