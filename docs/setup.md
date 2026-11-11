# Setup

Installing, API keys, and pulling environment variables from Vercel.

Requires Node.js 24 and a current Chrome or Edge for WebCodecs export support.

On Windows, run `powershell -ExecutionPolicy Bypass -File .\Start-Sparko.ps1` from this folder. The launcher installs dependencies if needed and starts the development server at **http://127.0.0.1:3000**. Keep its terminal open; Ctrl+C stops it. Add `-Port 3001` to use another port.

```sh
git lfs install
git lfs pull
npm install
npm run dev
```

Open **http://127.0.0.1:3000** and choose **Sample project** to open `examples/sample.sparko`, or **New project** to start with an empty timeline and drop your own videos onto it.

Copy `.env.example` to `.env` if you do not already have one. Set `COMFY_CLOUD_API_KEY` for H3 video generation, `FAL_KEY` for image generation and `ELEVENLABS_API_KEY` for dialogue, music and sound effects on the timeline. Set `OPENAI_API_KEY` for prompt enhancement and OpenAI analysis/voice features, and `GEMINI_KEY` for Gemini analysis/voice features; `COMFY_API_KEY` and `GEMINI_API_KEY` are also accepted. Keys are read only by the server and never bundled into the frontend. The existing `.env` is ignored by Git.

To fetch environment variables from an existing Vercel project:

```sh
npx vercel login
npx vercel link # Select the existing Sparko project; only needed once per checkout.
npm run vercel:env # Development variables by default.
npm run vercel:env -- production # Or: preview
```

The script pulls into the repository's `.env`, saving any previous file as `.env.backup-<timestamp>-<id>`. Failed downloads leave `.env` unchanged; temporary files and backups are ignored by Git and excluded from deployments. Restart the development server after pulling. The [Vercel CLI](https://vercel.com/docs/cli/env) preserves local-only entries when merging, but cannot download unreadable Secret values; keep those values locally or fill in the placeholders it creates. Pulling does not create or update variables on Vercel.

**Comfy model IDs are in [`shared/constants.ts`](../shared/constants.ts); the fal image and ElevenLabs audio model catalog is in [`shared/asset-generation.ts`](../shared/asset-generation.ts).** Change them there, then restart/redeploy; there are no model overrides in `.env`.
