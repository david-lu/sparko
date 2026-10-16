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

- Playback, pause, scrubbing, 10-second skip buttons, volume/mute, speed, loop, fullscreen, picture-in-picture where supported, and WebVTT subtitle loading. Controls overlay the video on hover or keyboard focus; touch devices keep them available. Space toggles playback across the app, including focused buttons, tabs and the timeline; editing text, numbers, selects and other input fields keeps their normal behavior.
- A single thumbnail timeline with hover previews, buffered ranges, and a playhead. Zoom with the **slider**, **− / +** or **Ctrl/Cmd + wheel**, scroll horizontally with the scrollbar, trackpad or wheel, and use **Fit** to show the whole video. Fit is the minimum zoom; maximum zoom is 32×. Zoom follows the pointer for wheel gestures and the visible playhead for controls. The scrollbar stays inside the panel with reserved space, so zooming does not change its height.
- Bright numbered pins can be added, renamed, dragged to another time, and clicked to seek. Dragging near a zoomed timeline's edges scrolls it automatically; Escape cancels a drag. Hover/focus a pin to reveal its delete button, or press Delete/Backspace while focused (touch keeps delete visible). Arrow keys move pins one frame, Shift moves one second, and Home/End move to the video boundaries. Pins stay sorted and are saved per source in browser local storage.
- Adjustable timeline height and side-panel width. Drag the dividers, or focus one and use arrow keys (Shift for larger steps). Sizes are remembered locally. Narrow screens stack the tools below the player; tool content scrolls within its panel.
- AI descriptions of a selected segment, up to 120 seconds. Choose a provider, enter start/end seconds, optionally set a focus, and generate a caption and description. Preview and cancel are supported. Captions here are descriptive summaries, not timed subtitle transcriptions.
- **ChatGPT / OpenAI:** Mediabunny samples up to 24 frames and extracts mono WAV audio. OpenAI transcribes the audio, then the Responses API returns structured caption/description JSON. Silent sources use visual context only.
- **Gemini:** Mediabunny exports the actual selected segment, capped at 720p for analysis. The backend uploads it to the Files API, waits for processing, requests a structured description, and deletes the remote file afterward.
- **Voice:** Open the Voice tab and choose **Enable mic**. The video pauses and the mic listens locally; an answer starts only after speech is detected, finishes after about 1.6 seconds of silence, and can be previewed, discarded or sent to OpenAI/Gemini. **Finish answer** ends it manually. Nothing is uploaded before **Send to LLM**. The mic shuts off on completion, cancellation, changing videos/tools, or hiding the browser tab. Permission errors are shown inline. Requires HTTPS or localhost.
- **fal.ai:** Uploads the current source and submits to `minimax/h3-max/insert-video`, including required `start_time` and `resume_time`, prompt, generated duration, and resolution. Queue polling, cancellation, refresh recovery, and the result video link are included. The generated video does not add another timeline track. Clicking Upload & generate starts a paid provider job.

Playback uses the browser media element for native transport, audio, PiP and subtitle support. Mediabunny powers the media-processing engine. Unsupported codecs produce a useful error; the app never silently exports a clip with dropped audio/video tracks.

## Spoken-answer API

`MicrophoneController` owns local voice activity detection through `@ricky0123/vad-web` and Silero, using ONNX Runtime Web. It waits for sustained speech, rejects brief misfires, and retains a 400 ms pre-speech buffer to preserve the first word. The detector and its assets are served by the app and loaded only when enabling the mic. The Silero model and detection settings live in `shared/constants.ts` alongside the LLM model IDs.

Answers are mono 16 kHz PCM WAV, capped at 60 seconds and 2 MB, and sent directly to the authenticated API on both localhost and Vercel. OpenAI transcribes the answer before passing it to the Responses API; Gemini receives the audio directly. Both return a transcript and a brief model response. Recordings are held in memory, not saved to browser storage or public Blob storage.

Future scene code can call the same API without changing recording or provider adapters:

```ts
import { MicrophoneController } from './src/lib/MicrophoneController';
import { sendVoiceAnswer } from './src/lib/api';

const microphone = new MicrophoneController();
const unsubscribe = microphone.subscribe(() => {
  // Render the status and enable your Submit action when phase === 'ready'.
  renderVoiceState(microphone.getSnapshot());
});
await microphone.enable(); // Listening; recording begins only when speech is detected.
async function submitAnswer() {
  const { audio } = microphone.getSnapshot();
  if (!audio) return;
  return sendVoiceAnswer(audio, 'openai', {
    sourceId: 'episode', videoTime: 12.5,
    sceneId: 'scene-1', // Optional, reserved for the future scene workflow.
    question: 'What happened?',
  });
}
// On teardown: unsubscribe(); microphone.dispose();
```

The endpoint is `POST /api/voice/:provider`, with multipart `audio` and JSON `context` fields. Context requires `sourceId` and `videoTime`; `sceneId` and `question` are optional. Timeline triggers, scene-question UI, automatic submission and grading are not implemented.

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
| `src/lib/MicrophoneController.ts` | Local speech detection, utterance capture, permission and microphone cleanup |
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

Browser tests use installed Google Chrome. They cover playback and settings, pins and persistence, subtitle toggling, viewport fit, resizing, real non-keyframe MP4 export with audio, real media preparation for AI requests, and local speech detection using synthetic audio (never your microphone). Unit tests cover voice cancellation, late permission grants, duration limits, provider adapters, and API validation. Provider responses and fal generation are mocked in automated tests to avoid recurring paid jobs. `tests/fixtures/voice-answer.wav` is a locally generated Windows speech-synthesis fixture.

Libraries: React, TypeScript, Vite, Mediabunny, `@mediabunny/aac-encoder`, `@ricky0123/vad-web` (with ONNX Runtime Web), Express, Multer, Zod, dotenv, OpenAI SDK, Google GenAI SDK, fal client, Vercel Blob, and Lucide. `vite-plugin-static-copy` bundles the speech detection assets. Tests use Vitest, Supertest, and Playwright.
