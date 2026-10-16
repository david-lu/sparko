# Sparko

A compact, single-page video workspace. React renders the UI; an independent `VideoPlayerController` owns playback, while `MediaEngine` uses Mediabunny for inspection, thumbnails, frame/audio extraction, and MP4 exports.

## Run locally

Requires Node.js 24 and a current Chrome or Edge for WebCodecs export support.

```sh
git lfs install
git lfs pull
npm install
npm run dev
```

Open **http://127.0.0.1:3000**. `episode_mock.mp4` loads by default and is tracked with Git LFS. Local videos can be opened through **File → Open video**, Ctrl/Cmd+O, or drag and drop. Only one source appears on the timeline.

Copy `.env.example` to `.env` if you do not already have one. Set `OPENAI_API_KEY`, `GEMINI_KEY`, and `FAL_KEY` to enable the providers. `GEMINI_API_KEY` and `FAL_API_KEY` are also accepted. Keys are read only by the server and never bundled into the frontend. The existing `.env` is ignored by Git.

**All model IDs are in [`shared/constants.ts`](shared/constants.ts).** Change them there, then restart/redeploy; there are no model overrides in `.env`.

## Features

- Playback, pause, scrubbing, 10-second skip buttons, volume/mute, speed, loop, fullscreen, picture-in-picture where supported, and WebVTT subtitle loading. Controls overlay the video on hover or keyboard focus; touch devices keep them available.
- A single thumbnail timeline with hover previews, buffered ranges, and a playhead. Bright numbered pins can be added, renamed, removed, and used to jump to a time. Pins are saved per source in browser local storage.
- Adjustable timeline height and side-panel width. Drag the dividers, or focus one and use arrow keys (Shift for larger steps). Sizes are remembered locally. Narrow screens stack the tools below the player; tool content scrolls within its panel.
- AI descriptions of a selected segment, up to 120 seconds. Choose a provider, enter start/end seconds, optionally set a focus, and generate a caption and description. Preview and cancel are supported. Captions here are descriptive summaries, not timed subtitle transcriptions.
- **ChatGPT / OpenAI:** Mediabunny samples up to 24 frames and extracts mono WAV audio. OpenAI transcribes the audio, then the Responses API returns structured caption/description JSON. Silent sources use visual context only.
- **Gemini:** Mediabunny exports the actual selected segment, capped at 720p for analysis. The backend uploads it to the Files API, waits for processing, requests a structured description, and deletes the remote file afterward.
- **fal.ai:** Uploads the current source and submits to `minimax/h3-max/insert-video`, including required `start_time` and `resume_time`, prompt, generated duration, and resolution. Queue polling, cancellation, refresh recovery, and the result video link are included. The generated video does not add another timeline track. Clicking Upload & generate starts a paid provider job.

Playback uses the browser media element for native transport, audio, PiP and subtitle support. Mediabunny powers the media-processing engine. Unsupported codecs produce a useful error; the app never silently exports a clip with dropped audio/video tracks.

## MP4 export API — intentionally no UI

```ts
import { MediaEngine } from './src/lib/MediaEngine';

const media = new MediaEngine({
  id: 'episode',
  name: 'episode_mock.mp4',
  url: '/media/episode_mock.mp4',
});
const abort = new AbortController();
try {
  const mp4: Blob = await media.exportMp4(
    { start: 12.345, end: 20.8 },
    { signal: abort.signal, onProgress: fraction => console.log(fraction) },
  );
  // Store/upload the Blob, or pass it to your own future export UI.
} finally {
  media.dispose();
}
```

Exports re-encode to H.264/AAC MP4, retaining source resolution by default and honoring arbitrary time boundaries at source-frame precision. The AAC extension supplies an encoder where native AAC encoding is unavailable. Export is in memory, so large cuts require sufficient browser memory. Progress 100% alone is not completion; await the returned promise. General exports have no 120-second limit; that limit applies only to AI analysis.

## Architecture

| File | Responsibility |
| --- | --- |
| `src/lib/VideoPlayerController.ts` | Media element lifecycle, transport commands, playback state subscriptions, segment preview |
| `src/lib/MediaEngine.ts` | Source-bound processing API, metadata caching, cancellation and disposal |
| `src/lib/media.ts` | Mediabunny reading, frame sampling, WAV conversion, MP4 conversion |
| `src/components/` | Player, analysis tools, fal jobs, accessible resizing |
| `server/app.ts` | Same-origin API, validation, range-enabled local video serving, temporary uploads |
| `server/providers.ts` | OpenAI, Gemini and fal adapters |
| `server/hosting.ts` | Vercel authentication, direct upload tokens, bounded downloads and cleanup |
| `shared/constants.ts` | AI model IDs and analysis limit |

## Vercel deployment

`vercel.json` builds the Vite frontend and routes API/media requests to `api/index.ts`, a Node.js function with a 300-second timeout. This repository is configured for deployment, but does not contain Vercel account credentials or a linked project.

Large videos go directly from the browser to **Vercel Blob**. They do not pass through the function request body, which has a [4.5 MB limit](https://vercel.com/docs/vercel-blob/client-upload). The 144 MB default video is excluded from the deployment bundle and served from Blob instead.

1. Run `npx vercel login` and `npx vercel link` to select your account/project.
2. Create a **public Blob store** in the project's Storage tab and connect it to Preview and Production. This creates `BLOB_READ_WRITE_TOKEN`.
3. Make that token available locally without overwriting your `.env` (for example, add it to `.env`), then run `npm run vercel:upload-default`. Set the printed URL as `DEFAULT_VIDEO_URL` in Vercel.
4. Set these server-side environment variables in Preview and Production:
   - `OPENAI_API_KEY`
   - `GEMINI_KEY`
   - `FAL_KEY`
   - `BLOB_READ_WRITE_TOKEN` (provided by the store)
   - `DEFAULT_VIDEO_URL`
   - `APP_PASSWORD` (a separate workspace password, not an API key)
5. Run `npm run deploy:preview`, or `npm run deploy:production` for production.

The deployed app requires the workspace password before granting upload tokens or making provider requests. The default video is served by its public Blob URL. Temporary analysis uploads use random URLs in `transient/` and are deleted after retrieval or request cleanup. An interrupted browser can leave an upload behind; remove old `transient/` objects in Blob as needed. Only the configured Blob store is accepted for remote API inputs. Local runs do not need Blob or a password.

Do not prefix API secrets with `VITE_`. Redeploy after changing deployment environment variables. This is a single-workspace app; pins and panel sizes remain browser-local, and API credits are shared by users of the workspace password.

## Verification

```sh
npm run build
npm test
npm run test:e2e
```

Browser tests use installed Google Chrome. They cover playback and settings, pins and persistence, subtitle toggling, viewport fit, resizing, real non-keyframe MP4 export with audio, and real media preparation for AI requests. Provider responses and fal generation are mocked in automated tests to avoid recurring paid jobs.

Libraries: React, TypeScript, Vite, Mediabunny, `@mediabunny/aac-encoder`, Express, Multer, Zod, dotenv, OpenAI SDK, Google GenAI SDK, fal client, Vercel Blob, and Lucide. Tests use Vitest, Supertest, and Playwright.
