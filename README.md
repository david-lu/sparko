# Sparko

A compact, single-page video workspace with generated interstitials. React renders the UI; independent controllers own playback and generation jobs. Mediabunny handles source inspection, reference clipping, and frame-based composition.

## Run locally

Requires Node.js 24 and a current Chrome or Edge for WebCodecs export support.

```sh
git lfs install
git lfs pull
npm install
npm run dev
```

Open **http://127.0.0.1:3000**. `episode_mock.mp4` loads by default and is tracked with Git LFS. Local videos can be opened through **File → Open video**, Ctrl/Cmd+O, or drag and drop. One timeline contains the original footage and any completed interstitials.

Copy `.env.example` to `.env` if you do not already have one. Set `OPENAI_API_KEY`, `GEMINI_KEY`, and `FAL_KEY` to enable the providers. `GEMINI_API_KEY` and `FAL_API_KEY` are also accepted. Keys are read only by the server and never bundled into the frontend. The existing `.env` is ignored by Git.

**All model IDs are in [`shared/constants.ts`](shared/constants.ts).** Change them there, then restart/redeploy; there are no model overrides in `.env`.

## Features

- Playback, pause, scrubbing, 10-second skip buttons, volume/mute, speed, loop, fullscreen, picture-in-picture where supported, and WebVTT subtitle loading. Controls overlay the video on hover or keyboard focus; touch devices keep them available. Space toggles playback across the app, including focused buttons, tabs and the timeline; editing text, numbers, selects and other input fields keeps their normal behavior.
- A single thumbnail timeline with hover previews, buffered ranges, and a playhead. Zoom with the **slider**, **− / +** or **Ctrl/Cmd + wheel**, scroll horizontally with the scrollbar, trackpad or wheel, and use **Fit** to show the whole video. Fit is the minimum zoom; maximum zoom is 32×. Zoom follows the pointer for wheel gestures and the visible playhead for controls. The scrollbar stays inside the panel with reserved space, so zooming does not change its height.
- Amber numbered **interstitial drafts** replace pins. Add with **P**, **Add draft**, or the sidebar; selecting a draft pauses and seeks to its anchor. Drafts, failed generations and completed scenes can be dragged or adjusted by one frame with arrow keys (Shift for one second). Moving retains the job and generated media; positions stay locked only while generation/loading is in progress. Delete from the sidebar or press Delete/Backspace on the selected interstitial outside text inputs. Pins have no delete button. Edge dragging scrolls the timeline; Escape cancels the drag. Existing saved pins migrate automatically.
- Adjustable timeline height and side-panel width. Drag the dividers, or focus one and use arrow keys (Shift for larger steps). Sizes are remembered locally. Narrow screens stack the tools below the player; tool content scrolls within its panel.
- AI descriptions of a selected segment, up to 120 seconds. Choose a provider, enter start/end seconds, optionally set a focus, and generate a caption and description. Preview and cancel are supported. Captions here are descriptive summaries, not timed subtitle transcriptions.
- **ChatGPT / OpenAI:** Mediabunny samples up to 24 frames and extracts mono WAV audio. OpenAI transcribes the audio, then the Responses API returns structured caption/description JSON. Silent sources use visual context only.
- **Gemini:** Mediabunny exports the actual selected segment, capped at 720p for analysis. The backend uploads it to the Files API, waits for processing, requests a structured description, and deletes the remote file afterward.
- **Voice:** Open the Voice tab and choose **Enable mic**. The video pauses and the mic listens locally; an answer starts only after speech is detected, finishes after about 1.6 seconds of silence, and can be previewed, discarded or sent to OpenAI/Gemini. **Finish answer** ends it manually. Nothing is uploaded before **Send to LLM**. The mic shuts off on completion, cancellation, changing videos/tools, or hiding the browser tab. Permission errors are shown inline. Requires HTTPS or localhost.
- **Interstitials:** The sidebar lists all drafts and jobs when nothing is selected. Selecting a draft exposes `start_range`, `end_range`, `duration`, and `prompt`. All three time controls have synchronized sliders and number inputs. Both reference ranges default to 2 seconds and are capped at 4; generated duration defaults to 6 seconds and supports 5–13 seconds. **Generate** prepares just that reference clip and submits a paid fal.ai job. Completed scenes become teal striped blocks in the timeline, expanding its duration while preserving the original video.

Source videos are prepared at **24 fps on import**, including the default episode and sources in older projects. Mediabunny creates an H.264/AAC working MP4 capped at **1080p** to reduce preparation time, preserving aspect ratio and playback speed. Smaller videos are not enlarged. `VIDEO_PREPARATION.maxHeight` in `shared/constants.ts` controls the cap; use `0` for full resolution. Existing compatible 24 fps MP4s, including previously prepared full-resolution files, are reused without encoding or resizing. Preparation checks every video packet's timing, so a variable frame rate with a 24 fps average cannot bypass conversion. Progress and cancellation are available; progress updates are limited to whole percentages. `TIMELINE_FPS` controls playback, seeking, frame stepping, pin snapping and composed exports. The browser media element plays the prepared file directly until interstitials are added, retaining native transport, audio, PiP and subtitles. Unsupported codecs produce a useful error; the app never silently prepares a file with dropped audio/video tracks.

## Local projects and portable project files

Videos opened through **File → Open video**, completed interstitial videos, and WebVTT subtitle files are stored as Blobs in **IndexedDB**. Source preparation saves both the original and the converted working video in one transaction before activating the project. Cancellation or storage failure leaves the previous project intact. Playback, reference clipping, thumbnails and analysis all use the working video. Reloading reuses its saved bytes without converting again. Project metadata autosaves alongside the assets, and the last active project reopens on refresh. Existing saved pins/interstitials migrate when their source is first opened. Remote interstitials are downloaded once and subsequently read from their local copy.

**File → Export project** downloads a self-contained `.sparko` file. It is a ZIP archive containing a versioned `project.json` manifest and all referenced media bytes: the prepared source, its retained original, generated videos, and subtitles. It also includes interstitial anchors, reference ranges, prompts, generation states and job IDs, plus the description tool's range, provider, focus and latest caption/description. Generated videos retain their reference footage and exact inserted-section bounds. API keys, workspace passwords and temporary microphone recordings are not project content and are never included.

**File → Import project** (or dropping a `.sparko` file onto the app) validates the archive, checks media boundaries, and stores it as a separate local project. It does not overwrite the open project's data. Asset IDs are remapped so importing the same archive twice cannot mix their media. ZIP checksums detect damaged files; missing assets, unsupported versions and invalid metadata are rejected. Imported media is committed in one IndexedDB transaction. Import/export shows progress and supports cancellation. Storage/quota errors leave the previous project available.

Exports are snapshots taken when export starts. Unfinished remote jobs retain their job IDs; they can resume polling with access to the original fal account. Upload/preparation work interrupted before a job was submitted returns to a draft. An interstitial whose result is still downloading must finish saving (or successfully retry loading) before it can be included in an export. Project export copies the stored media without encoding. Import reuses a compatible prepared source; older archives prepare their source once before committing any imported assets.

The current archive limit is **8 GB of media** and **8 MB of metadata**. Media uses uncompressed ZIP entries to avoid spending time recompressing MP4s. Browser storage belongs to this browser profile and origin; clearing site data removes it, and browsers may evict it under storage pressure. Export project files for portable backups. Saved assets can play without the original local file or fal URL, once the app itself is loaded; this is not an offline installation of the app. Panel layout and transient playback controls remain workspace preferences.

## Interstitial generation and playback

`start_range` is the footage before the draft and `end_range` is the footage after it. Ranges and anchors align to the project's 24 fps frame grid. The UI shows the actual clipped reference range. [H3 Max's schema](https://fal.ai/models/minimax/h3-max/insert-video/api) requires a start of at least 1.625 seconds and a later resume point. Reference clips are converted to 24 fps and insertion coordinates are calculated from integer frame indices with a one-frame replacement interval. Generation also requires return footage after the resume point. Drafts may still be placed at video boundaries, but generation explains why those positions need adjustment.

Generated duration is saved per draft, including in exported projects. Its default and limits (6 seconds, 5–13 allowed), resolution (768p), and reference limits are configured in `shared/constants.ts`. The interstitial panel's **Prompt expansion** checkbox controls fal's optional prompt expansion per draft and is saved in the project. It defaults to off (`enablePromptExpansion: false` in the constants), which uses the supplied prompt directly. Older projects without this setting also default to off; those without a duration use the six-second default. Mediabunny exports an H.264/AAC reference MP4 capped at 768p and 50 MB. `POST /api/interstitials` validates the requested duration, actual file and frame-aligned insertion coordinates before submitting to fal. The replacement interval applies only to the reference video; playback resumes at the original anchor on the project timeline. Rejected requests show fal's validation explanation and request ID, with credentials and URLs removed. Failed interstitials stay editable with the error visible; **Retry** uses the updated settings without a separate reset step.

Fal returns the complete reference video with its generated scene. The adapter retains the returned `start_time` and `injected_duration`; playback inserts only that interval. A completed interstitial's **Download full video** action saves the entire generated MP4, including both reference ranges and audio, directly from the cached asset without re-encoding. Preparation shows measured progress; upload, queue position, generation and saving/loading the result have separate waiting states. Cancellation, failed-job retry, saved draft fields, and recovery after refresh are supported. Retry reuses an already returned video if only loading failed and its settings are unchanged; failed generations and edited drafts submit a new job after retiring any previous active job. Once downloaded into IndexedDB, the result no longer depends on the provider's URL retention policy.

The interstitial editor stays editable in every state, including preparation, generation, loading and reopening saved results. **Generate** creates the first scene, **Regenerate** replaces a completed scene, and **Retry** recovers from a failure or cancellation without a reset step. Each job saves a snapshot of its submitted settings; edits made while it runs are saved for the next generation and cannot change the in-flight request. An unchanged failed download offers **Retry loading** without another generation. Submitted settings and pending edits both survive reload and project export/import.

The existing scene stays playable and downloadable until its replacement is saved and validated, including after a failure or cancellation. Retained videos are included in IndexedDB saves and project archives. Loading is visible directly on the timeline: a spinner inside the pin before the first result, or inside the existing video block during regeneration. Hovering shows the current stage and preparation percentage or queue position when available. The spinner clears on completion, failure or cancellation.

`TimelineComposition` builds an immutable edit list using integer 24 fps frame indices. Anchors remain in original-video time, so earlier inserts do not change later references. Saved anchors from earlier versions snap to the nearest project frame when rendered. Video is sampled on that project frame grid (variable-frame-rate sources and different generated frame rates are normalized). Duration rounds to the nearest project frame. Audio is trimmed at sample boundaries, retimed, and encoded on one continuous clock. Original subtitle cues follow the source footage and are split around inserted scenes.

When completed interstitials are present, `TimelineStream` progressively feeds 24 fps fragmented MP4 into one native video element through MediaSource. Generated videos and the prepared source are read from cached assets through Mediabunny. Composition still requires video/audio encoding across the cuts; source-only playback does not. Preview encoding runs ahead by at most eight seconds, evicts old buffered media, and restarts from the requested frame on an unbuffered seek. Composed preview resolution is capped at 720p; source-only playback and composed exports use the working video's resolution (up to 1080p for newly converted files). The original-resolution file is retained in the project archive. Browsers without compatible MediaSource support prepare a complete composed MP4 before playback. Codec support and device performance can cause buffering, which is shown in the player.

This streams playback **after fal finishes generation**; the provider workflow exposes queued jobs and a completed video URL, not an incremental generated-frame feed. Scene boundaries are exact on the project frame grid; visual continuity of the generated content still depends on the model.

The composed timeline also has a code-only export API, with no export UI:

```ts
import { TimelineComposition } from './src/media/TimelineComposition';
import { TimelineStream } from './src/media/TimelineStream';

const composition = new TimelineComposition(source, mediaInfo, interstitials);
const mp4 = await new TimelineStream(composition).exportMp4(
  { start: 0, end: composition.duration },
  abortController.signal,
  progress => console.log(progress),
);
```

Composed exports use the source dimensions, H.264/AAC, and the same frame/sample boundaries as preview. Description requests still analyze original-source ranges; voice context records source time. Microphone scene triggers remain separate future work.

## Spoken-answer API

`MicrophoneController` owns local voice activity detection through `@ricky0123/vad-web` and Silero, using ONNX Runtime Web. It waits for sustained speech, rejects brief misfires, and retains a 400 ms pre-speech buffer to preserve the first word. The detector and its assets are served by the app and loaded only when enabling the mic. The Silero model and detection settings live in `shared/constants.ts` alongside the LLM model IDs.

Answers are mono 16 kHz PCM WAV, capped at 60 seconds and 2 MB, and sent directly to the authenticated API on both localhost and Vercel. OpenAI transcribes the answer before passing it to the Responses API; Gemini receives the audio directly. Both return a transcript and a brief model response. Recordings are held in memory, not saved to browser storage or public Blob storage.

Future scene code can call the same API without changing recording or provider adapters:

```ts
import { MicrophoneController } from './src/features/voice-input/MicrophoneController';
import { sendVoiceAnswer } from './src/features/voice-input/api';

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
import { MediaEngine } from './src/media/MediaEngine';

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

Code is grouped by feature. Each frontend feature owns its UI, behavior, styles and feature-specific API calls. Server features own request validation and provider adapters; shared modules supply infrastructure. The app and server entry points compose these pieces.

| Folder / file | Responsibility |
| --- | --- |
| `src/app/` | Workspace composition, menus, sidebar tabs, layout and common styles |
| `src/features/player/` | Video UI, transport, shortcuts, captions, and VideoPlayerController |
| `src/features/timeline/` | Timeline zoom/scroll, draggable draft markers and rendered scene blocks |
| `src/features/interstitials/` | Draft editor/list, persistence/migration and independent generation-job lifecycle |
| `src/features/project/` | ProjectController, IndexedDB projects/assets, Blob URL resolution, portable archive validation and import/export |
| `src/features/voice-input/` | Voice panel, MicrophoneController, local speech detection, recording and submission |
| `src/features/video-analysis/` | Segment selection, captions/descriptions and analysis requests |
| `src/media/` | MediaEngine, TimelineComposition, CompositionRenderer and TimelineStream: inspection, clipping, composition, streaming and export |
| `src/shared/` | Shared HTTP/upload transport and accessible resize control |
| `server/features/voice-input/` | Audio/context validation and OpenAI/Gemini spoken-answer adapters |
| `server/features/video-analysis/` | Clip/frame validation and OpenAI/Gemini caption adapters |
| `server/features/video-insertion/` | fal.ai source validation, upload, submission, polling and cancellation |
| `server/features/interstitials/` | Bounded reference-clip validation and interstitial job submission |
| `server/shared/` | HTTP protection/errors, temporary uploads, media validation and SDK clients |
| `server/app.ts`, `server/providers.ts` | Route and provider composition; no feature implementations |
| `server/hosting.ts` | Vercel authentication, direct upload tokens, bounded downloads and cleanup |
| `shared/contracts.ts` | API contracts and time/range helpers shared by browser and server |
| `shared/constants.ts` | All AI model IDs, limits and voice detection settings |
| `tests/interstitials/`, `tests/voice-input/`, `tests/browser/`, `tests/fixtures/` | Controller/composition tests, browser coverage and reusable media fixtures |

Feature APIs use shared HTTP transport; shared transport does not import feature code. Browser code never imports server implementations. Model IDs remain centralized in `shared/constants.ts`.

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

Do not prefix API secrets with `VITE_`. Redeploy after changing deployment environment variables. This is a single-workspace app; interstitials and panel sizes remain browser-local, and API credits are shared by users of the workspace password.

## Verification

```sh
npm run build
npm test
npm run test:e2e
```

Browser tests use installed Google Chrome. They cover playback, draggable drafts, persistence, subtitle toggling, viewport fit, resizing, real non-keyframe MP4 export with audio, real reference preparation, interstitial job recovery/cancellation, progressive playback across cuts, and composed-export frame counts and audio. Voice tests use synthetic audio, never your microphone. Unit tests cover frame mapping, reference bounds, legacy migration, job lifecycle, voice capture, provider adapters, and API validation. Provider responses and fal generation are mocked to avoid recurring paid jobs; media processing runs for real. `tests/fixtures/voice-answer.wav` is a locally generated Windows speech-synthesis fixture; `interstitial-reference.mp4` is a synthetic four-second validation fixture.

Project tests cover binary archive round trips, invalid/corrupt archives, fresh-browser import with remote assets blocked, local-file recovery after reload, subtitle/description persistence, and storage failures. Native IndexedDB stores media and metadata; [zip.js](https://gildas-lormeau.github.io/zip.js/) packages and validates the project archive.

Preparation checks cover 25-to-24 fps conversion, variable frame spacing, direct playback of the saved working file, zero video encoding on reload, cancellation without partial assets, and migration of older projects. The browser suite prepares the real default episode once per worker and serves that fixture over local HTTP so each isolated test does not repeat the full conversion.

Libraries: React, TypeScript, Vite, Mediabunny, `@mediabunny/aac-encoder`, `@zip.js/zip.js`, `@ricky0123/vad-web` (with ONNX Runtime Web), Express, Multer, Zod, dotenv, OpenAI SDK, Google GenAI SDK, fal client, Vercel Blob, and Lucide. `vite-plugin-static-copy` bundles the speech detection assets. Tests use Vitest, Supertest, and Playwright.
