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

Open **http://127.0.0.1:3000** and choose **Sample video** to open `examples/sample.mp4`. Create a project from a local video on the project chooser, or drag and drop a video. One timeline contains the original footage and any completed interstitials.

Copy `.env.example` to `.env` if you do not already have one. Set `COMFY_CLOUD_API_KEY` for interstitial generation. Set `OPENAI_API_KEY` and `GEMINI_KEY` for their respective analysis and voice features; `COMFY_API_KEY` and `GEMINI_API_KEY` are also accepted. Keys are read only by the server and never bundled into the frontend. The existing `.env` is ignored by Git.

**All model IDs are in [`shared/constants.ts`](shared/constants.ts).** Change them there, then restart/redeploy; there are no model overrides in `.env`.

## Features

- Playback, pause, scrubbing, 10-second skip buttons, volume/mute, speed, loop, fullscreen, picture-in-picture where supported, and WebVTT subtitle loading. Controls overlay the video on hover or keyboard focus; touch devices keep them available. Space toggles playback across the app, including focused buttons, tabs and the timeline; editing text, numbers, selects and other input fields keeps their normal behavior.
- A single thumbnail timeline with hover previews, buffered ranges, and a playhead. Zoom with the **slider**, **− / +** or **Ctrl/Cmd + wheel**, scroll horizontally with the scrollbar, trackpad or wheel, and use **Fit** to show the whole video. Fit is the minimum zoom; maximum zoom is 32×. Zoom follows the pointer for wheel gestures and the visible playhead for controls. The scrollbar stays inside the panel with reserved space, so zooming does not change its height.
- Amber numbered **regular interstitial drafts** replace pins. Add one from the Interstitials sidebar or press **P**; selecting a draft pauses and seeks to its anchor. Drafts, failed generations and completed scenes can be dragged or adjusted by one frame with arrow keys (Shift for one second). Moving retains the job and generated media; positions stay locked only while generation/loading is in progress. Delete from the sidebar or press Delete/Backspace on the selected interstitial outside text inputs. Pins have no delete button. Edge dragging scrolls the timeline; Escape cancels the drag. Existing saved pins migrate automatically.
- Adjustable timeline height and side-panel width. Drag the dividers, or focus one and use arrow keys (Shift for larger steps). Sizes are remembered locally. Narrow screens stack the tools below the player; tool content scrolls within its panel.
- AI descriptions of a selected segment, up to 120 seconds. Choose a provider, enter start/end seconds, optionally set a focus, and generate a caption and description. Preview and cancel are supported. Captions here are descriptive summaries, not timed subtitle transcriptions.
- **ChatGPT / OpenAI:** Mediabunny samples up to 24 frames and extracts mono WAV audio. OpenAI transcribes the audio, then the Responses API returns structured caption/description JSON. Silent sources use visual context only.
- **Gemini:** Mediabunny exports the actual selected segment, capped at 720p for analysis. The backend uploads it to the Files API, waits for processing, requests a structured description, and deletes the remote file afterward.
- **Voice:** Open the Voice tab and choose **Enable mic**. The video pauses and the mic listens locally; an answer starts only after speech is detected, finishes after about 1.6 seconds of silence, and can be previewed, discarded or sent to OpenAI/Gemini. **Finish answer** ends it manually. Nothing is uploaded before **Send to LLM**. The mic shuts off on completion, cancellation, changing videos/tools, or hiding the browser tab. Permission errors are shown inline. Requires HTTPS or localhost.
- **Interstitials:** The sidebar lists all drafts and jobs when nothing is selected. Selecting a draft exposes `start_range`, `end_range`, `duration`, and `prompt`. All three time controls have synchronized sliders and number inputs. Both reference ranges default to 2 seconds and are capped at 4; generated duration defaults to 6 seconds and supports 5–13 seconds. **Generate** prepares the reference clip and submits a Comfy Cloud job. Completed scenes become teal striped blocks in the timeline, expanding its duration while preserving the original video.

Source videos that the browser and Mediabunny can decode play in their native format and frame rate, including the 25 fps default episode. Import checks native playback using the first decoded frame; it does not encode the whole source. If native playback is unavailable but conversion is supported, Mediabunny creates an H.264/AAC working MP4 at 24 fps, capped at **1080p**. `VIDEO_PREPARATION.maxHeight` in `shared/constants.ts` controls that fallback cap; use `0` for full resolution. Existing compatible 24 fps MP4s can still be reused by the conversion helper. Progress and cancellation are available for fallback conversion. `TIMELINE_FPS` remains the 24 fps clock for pin snapping, frame stepping, reference clips, and composed outputs. The browser media element plays the source directly until interstitials are added, retaining native transport, audio, PiP and subtitles. Unsupported codecs produce a useful error; the app never silently prepares a file with dropped audio/video tracks.

## Call-response editing

New interstitials start as **Untitled**. Edit the name at the top of the interstitial panel, then press Enter or click away to save; Escape cancels the edit. Names support undo/redo and survive saving and reopening a project file. The Interstitials sidebar has separate **Add regular interstitial** and **Add call-response interstitial** buttons. Their type is fixed at creation.

Undo and redo are available beside **File** and through **Ctrl/Cmd+Z**, **Ctrl/Cmd+Shift+Z**, or **Ctrl+Y**. History covers adding, moving, editing, and removing interstitials, clip types, branch connections, shared response durations, and subtitle imports. Removing a call-response group is one undoable action. Consecutive typing and slider edits are grouped; a new edit clears redo. Up to 100 edits are retained for the current session, resetting when a project is opened or the page reloads. Restored edits autosave. Generation jobs keep their latest status and media; restoring a deleted clip reuses its retained media.

To build a call-response timeline, select **Add call-response interstitial** in the sidebar. The editor creates Call, Idle, and response drafts for editing and generation. The source timeline stays unchanged while those clips are drafts; the branching timeline appears after the videos are generated. The browser test suite can create completed clip assets without provider requests to exercise the timeline.

All non-Video clips belong to one saved **Call Response Interstitial**, shown as one group in the timeline and one parent with child clips in the sidebar. Filmstrips carry **Call**, **Idle**, and **[answer label] Response** badges; Idle also has a loop icon. Ordinary Video clips have no type badge and stay outside the group. Changing a clip type updates membership. The parent ID, insertion anchor, and child clip IDs survive saving and reopening a project file; older examples acquire this parent when loaded. Each generated child retains its existing interstitial generation settings and media. A creation workflow for the whole interstitial is not included yet.

Answers are editable options with stable IDs, labels, accepted text alternatives, and individual response clips. Use **Add answer** in the parent panel, then open a response clip to edit its **Answer label**, optional **Also accept** alternatives (one per line), or **Remove answer**. At least one answer must remain; up to 100 options are supported. Labels themselves are accepted as answers; matching ignores case, surrounding whitespace, and trailing sentence punctuation. Idle's **Unmatched answer** setting chooses a fallback option or keeps waiting. Older Correct/Incorrect projects migrate without changing their existing matching or media. Adding an option reuses a video excerpt as preview media until its response is regenerated. Adding, editing, and removing answers supports undo/redo and autosave; removal cancels that clip's generation job before removing its records and connections.

The green timeline container encloses all child clips. Click its empty space or border to select the whole interstitial and seek to that time; its numbered marker selects without seeking. Empty space elsewhere in the timeline and the ruler also seek at the clicked position, including when zoomed or scrolled. Each clip has a collapsible subpanel inside the parent panel with its own prompt, settings, preview, generation progress, cancellation, and regeneration button. Clicking a timeline clip opens its subpanel. Remove the whole interstitial using its sidebar trash button or Delete/Backspace while the parent is selected. Removal cancels active child jobs and retains the source video and unrelated interstitials; if cancellation fails, the group remains available for retry.

Generation references follow **Source → Call → Idle → selected response**, independently of playback retry connections. A child uses the latest preceding clip's tail; Call and Idle return to a held boundary pose, while responses bridge back to the source continuation. Submitted media references are saved with each result and remapped on project import. Replacing an upstream result marks dependent clips **Needs regeneration**, and a child waits until its immediate predecessor is ready and current. Existing videos remain playable until each replacement loads successfully. Regenerating one response leaves the other branches untouched; response duration settings remain linked.

Clip type controls behavior: **Video** and **Call** play once, **Idle** repeats until an answer is available, and **Response** plays the selected reaction. The timeline shows video filmstrips, with a 76 px maximum clip height, centered sequential clips, and one stacked row per response. Select a clip to inspect its type and its interstitial settings in the sidebar. While an Idle clip is active, a centered debug button for each answer appears over the video player, with the selected answer marked. Buttons wrap on smaller screens; the timeline scrolls vertically when needed. Clicking a button starts playback, queues that branch, and takes it at the next loop boundary. All response branches share the duration requested for their next generation.

Select a connection in the sidebar to inspect its destination, or hover over a clip and click its output dot and then another clip to reconnect it. Reconnecting **Give a hint → Idle** makes an incorrect answer retry. Connections drive actual clip playback. The ruler shows one idle cycle and the longer response lane; actual elapsed duration depends on the answer. Clip types and connections autosave and survive project export/import (version 2 archives; version 1 remains supported). The test fixture and clip types live in `src/features/call-response/model.ts`.

Call-response playback uses preloaded native video elements. Original source ranges play directly; generated clips are prepared once as H.264/AAC at the source frame rate and dimensions. Alternatives are prepared ahead, and idle loops reuse the same media. Answers select the next loop boundary without committing an extra encoded cycle. Source captions retain their original timestamps and stay off generated footage.

Native playback keeps at most three video elements: two for overlapping clips and one for preloading. Generated derivatives use a separate 256 MB local cache keyed by media contents, source playback settings, and framing preference. Reopening an archive can reuse conversions even after asset IDs are remapped. Changing a project or playback settings cancels obsolete work. Slow decoding or a generated clip that is still being prepared can still cause buffering.

## Local projects and portable project files

Videos opened from the project chooser, completed interstitial videos, and WebVTT subtitles are stored as Blobs in **IndexedDB**. Browser-playable source media is retained unchanged. An unsupported source uses a compatible working copy while retaining its original. Cancellation or storage failure leaves the previous project intact. Project metadata autosaves to a browser working copy; **Save project** writes the complete project to a portable file. Remote generated clips are downloaded once and subsequently read locally.

**File → Export project** downloads a self-contained `.sparko` file. It is a ZIP archive containing a versioned `project.json` manifest and all referenced media bytes: the prepared source, its retained original, generated videos, and subtitles. It also includes interstitial anchors, reference ranges, prompts, generation states and job IDs, plus the description tool's range, provider, focus and latest caption/description. Generated videos retain their reference footage and exact inserted-section bounds. API keys, workspace passwords and temporary microphone recordings are not project content and are never included.

**Open project file** on the project chooser (or dropping a `.sparko` file onto the app) validates the archive, checks media boundaries, and opens it as a local working project. A native file picker keeps the file handle for subsequent saves and Recent; drag and drop or the fallback input require **Save as new file** to establish a file handle. Asset IDs are remapped so importing the same archive twice cannot mix their media. ZIP checksums detect damaged files; missing assets, unsupported versions and invalid metadata are rejected. Imported media is committed in one IndexedDB transaction. Opening and exporting show progress and support cancellation. Storage/quota errors leave the previous project available.

Exports are snapshots taken when export starts. Unfinished remote jobs retain their job IDs and can resume with the original provider account. Interrupted preparation returns to a draft. Project export copies stored originals without encoding. Opening a `.sparko` file checks every saved generated result, retained result, and branch asset against the native source. Older archives with both a 24 fps working copy and a playable original restore the original source and reconnect its timeline scenes. Mismatched generated media is converted before activation, with progress and cancellation. Compatible clips are reused. Conversion changes playback copies only; saved clip bounds, originals, and generation references retain their meaning.

The current archive limit is **8 GB of media** and **8 MB of metadata**. Media uses uncompressed ZIP entries to avoid spending time recompressing MP4s. Browser storage belongs to this browser profile and origin; clearing site data removes it, and browsers may evict it under storage pressure. Export project files for portable backups. Saved assets can play without the original local file or provider URL, once the app itself is loaded; this is not an offline installation of the app. Panel layout and transient playback controls remain workspace preferences.

## Interstitial generation and playback

`start_range` is the footage before the draft and `end_range` is the footage after it. Ranges and anchors align to the project's 24 fps frame grid. The UI shows the actual clipped reference range. The H3 workflow requires at least 1.625 seconds of context on each side. Reference clips are converted to 24 fps and insertion coordinates are calculated from integer frame indices. Drafts may still be placed at video boundaries, but generation explains why those positions need adjustment.

Generated duration is saved per draft, including in exported projects. Its default and limits (6 seconds, 5–13 allowed) and reference limits are configured in `shared/constants.ts`. Older projects without a duration use the six-second default. Mediabunny exports an H.264/AAC reference MP4 capped at **960 pixels on its longest edge** and 50 MB. These are Sparko limits, not a universal Comfy Cloud upload specification. `POST /api/comfy/interstitials` validates the requested duration, file and frame-aligned insertion coordinates before submitting the workflow. The generated middle is inserted at the original anchor on the project timeline. Failed interstitials stay editable with the error visible; **Retry** uses the updated settings without a separate reset step.

Comfy returns a video with both context ranges and the generated middle. Sparko stores the generated section's exact bounds and inserts only that section. A completed interstitial's **Download full video** action saves the entire generated MP4, including both reference ranges and audio, directly from the cached asset without re-encoding. Preparation shows measured progress; upload, queue position, generation and saving/loading the result have separate waiting states. Cancellation, failed-job retry, and saved draft fields are supported. Retry reuses an already returned video if only loading failed and its settings are unchanged; failed generations and edited drafts submit a new job after retiring any previous active job. Once downloaded into IndexedDB, the result no longer depends on the provider's URL retention policy.

The interstitial editor stays editable in every state, including preparation, generation, loading and reopening saved results. **Generate** creates the first scene, **Regenerate** replaces a completed scene, and **Retry** recovers from a failure or cancellation without a reset step. Each job saves a snapshot of its submitted settings; edits made while it runs are saved for the next generation and cannot change the in-flight request. An unchanged failed download offers **Retry loading** without another generation. Submitted settings and pending edits are included in project files.

The existing scene stays playable and downloadable until its replacement is saved and validated, including after a failure or cancellation. Retained videos are included in IndexedDB saves and project archives. Loading is visible directly on the timeline: a spinner inside the pin before the first result, or inside the existing video block during regeneration. Hovering shows the current stage and preparation percentage or queue position when available. The spinner clears on completion, failure or cancellation.

`TimelineComposition` keeps the existing 24 fps edit grid for saved anchors and clip boundaries. Playback is timestamp based: the native source keeps its own frame cadence, and generated clips match its nominal frame rate and dimensions. No source frames are encoded for preview. Variable-frame-rate source timestamps remain native. Explicit composed exports still sample the edit grid and encode one video/audio stream.

`NativeTimelinePlayback` plays the original source and prepared generated media through preloaded native elements. Seeking positions the relevant clips directly. Crossfades blend their opacity and volume over the project's selected transition interval. `GeneratedPlaybackMedia` converts only mismatched generated assets and caches the results, preserving their original files for downloads and archives. `TimelineStream.exportMp4` remains an explicit composed-export helper, capped at 1080p; it is not used for playback.

Playback starts **after Comfy finishes generation**; progress events show workflow stages and sampler steps, while the playable video is available after completion. Scene boundaries are exact on the project frame grid; visual continuity of the generated content still depends on the model.

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

## Comfy Cloud interstitials

Regular and call-response drafts use Comfy Cloud H3 workflows. The selected H3 workflow and exact generated-section bounds are included in project files. Regeneration retains the previous video until a replacement is ready and supports retry, independent preview, timeline thumbnails/loading feedback, and downloading the whole output. Older project archives containing Fal-generated media remain readable; pending Fal jobs cannot resume.

Set `COMFY_CLOUD_API_KEY` in `.env`, then restart `npm run dev`. `COMFY_API_KEY` is also accepted. `COMFY_BASE_URL` defaults to `https://cloud.comfy.org`; it can point to a compatible HTTPS Comfy API deployment. Set the same server-only variables in Vercel and redeploy there. Run `npm run comfy:check` to verify authentication, required nodes, and H3 model availability without submitting a generation. Model filenames and sampling settings live in `shared/constants.ts`.

This implementation uses the [Comfy API v2](https://docs.comfy.org/api-reference/v2/overview) and native H3 video/audio latents with [MaskVidExperiments](https://github.com/drozbay/MaskVidExperiments). The specific `MiniMaxH3ContexMaskedAVBridge` custom node from the linked community workflow was absent from the managed Cloud catalog during setup. Instead, this graph independently encodes both context clips, places them at opposite ends of an H3 latent, and masks the missing middle using available Cloud nodes. When source audio exists it is conditioned and masked too; otherwise H3 generates audio. Image quality and boundary continuity need evaluation with actual generations.

H3 requires frame counts of `5 + 17k` at 24 fps. Context ranges round down to usable model windows, and total duration rounds up to the next valid frame count. A six-second draft with two-second reference ranges therefore uses 39 frames (1.625 seconds) per side and generates 148 frames (6.167 seconds). The panel shows these effective values before generation. At least 1.625 seconds of source footage must exist on both sides. Sparko caps the full target at 362 frames and 960 pixels on the longest edge, then rounds dimensions to multiples of 32. Comfy's [H3 native guide](https://docs.comfy.org/tutorials/video/minimax/minimax-h3-native) describes a 768-pixel **short edge** for the native canvas; that is a model canvas recommendation, not a Cloud input upload cap. Only the generated middle is inserted into Sparko's timeline; original footage remains the source outside it.

**Options → Interstitial crossfades** enables a dissolve at each generated clip join. The default length is 12 frames (0.5 seconds on the 24 fps edit grid), and the selected length is saved in the project and its `.sparko` archive. Playback blends opacity and audio volume; composed exports use the same transition bounds. Seeking inside a fade positions both clips. Saved reference footage limits each fade, so short handles produce shorter fades. Anchors and timeline duration remain fixed. Turning the option off restores hard cuts; that on/off choice remains a browser preference.

Comfy jobs stream live workflow stages and sampler steps over authenticated server-sent events: loading H3, encoding references, generating video/audio (for example, step 8/20), decoding, and encoding the MP4. The interstitial panel and timeline status show these updates alongside overall progress. Streams reconnect after a disconnect; regular status polling remains available as a fallback and retrieves the final result or error. Closing a stream does not cancel the job. Completed outputs are streamed through an authenticated application endpoint and saved into IndexedDB. The server resolves a fresh signed storage URL for each download/retry, so an expired URL does not require paying for another generation. Keys stay on the server. Provider submissions are never automatically retried after ambiguous network failures. Progress streams during generation; the playable video becomes available after the job completes.

Comfy server code is isolated in `server/features/comfy/`; shared frame planning is in `shared/comfy.ts`. No additional npm dependencies are required. Existing voice and description code remains available internally, but their panels are currently removed from the editor.

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
  name: 'sample.mp4',
  url: '/media/sample.mp4',
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
| `src/media/` | MediaEngine, TimelineComposition, GeneratedPlaybackMedia and CompositionRenderer: inspection, generated media preparation, clipping and explicit export |
| `src/shared/` | Shared HTTP/upload transport and accessible resize control |
| `server/features/voice-input/` | Audio/context validation and OpenAI/Gemini spoken-answer adapters |
| `server/features/video-analysis/` | Clip/frame validation and OpenAI/Gemini caption adapters |
| `server/features/comfy/` | Comfy Cloud reference validation, workflow submission, polling, progress and output downloads |
| `server/shared/` | HTTP protection/errors, temporary uploads, media validation and SDK clients |
| `server/app.ts`, `server/providers.ts` | Route and provider composition; no feature implementations |
| `server/hosting.ts` | Vercel authentication, direct upload tokens, bounded downloads and cleanup |
| `shared/contracts.ts` | API contracts and time/range helpers shared by browser and server |
| `shared/constants.ts` | All AI model IDs, limits and voice detection settings |
| `tests/interstitials/`, `tests/voice-input/`, `tests/browser/`, `tests/fixtures/` | Controller/composition tests, browser coverage and reusable media fixtures |

Feature APIs use shared HTTP transport; shared transport does not import feature code. Browser code never imports server implementations. Model IDs remain centralized in `shared/constants.ts`.

## Vercel deployment

`vercel.json` builds the Vite frontend and routes API/media requests to `api/index.ts`, a Node.js function with a 300-second timeout. Account credentials and local Vercel project links are not committed.

Server-side relative imports use explicit `.js` extensions so Vercel's compiled Node.js ES modules resolve correctly; `tsx` and Vite resolve these to the TypeScript sources during development.

Large videos go directly from the browser to **Vercel Blob**. They do not pass through the function request body, which has a [4.5 MB limit](https://vercel.com/docs/vercel-blob/client-upload). The sample video and project archive are excluded from the deployment bundle and served from Blob instead.

The sample project is [`examples/sample.sparko`](examples/sample.sparko), a portable project with `sample.mp4`, eight completed interstitials, two drafts, and a saved 0.5-second crossfade. It is tracked with Git LFS; run `git lfs pull` before uploading from a fresh checkout. The archive is approximately 145 MiB.

The app starts with a project chooser showing recent projects, sample projects, and an action to create a project from a video. **Sample video** loads `examples/sample.mp4` as a clean project; **Sample project** opens `examples/sample.sparko` with its saved interstitials. Each loads only when selected. **File → Close project** closes the active editor and returns to the chooser; changed projects ask whether to save, discard, or cancel. **File → Save project** creates a `.sparko` file on disk; later saves update that same file. **Save as new file** chooses another path. **Recent projects** stores references to opened or saved files so they can be reopened, removed from Recent, or deleted from disk where the browser supports file deletion. The `.sparko` file contains the project and its media, so it can also be moved to another computer. In browsers without the native file picker, Save downloads the archive and **Open project file** uses a normal file input; those browsers cannot update the same file or list it in Recent. Older browser-only projects remain available on the chooser for migration. On Vercel, run `npm run vercel:upload-default` for the sample video and `npm run vercel:upload-sample` for the sample project, then set `DEFAULT_VIDEO_URL` and `DEFAULT_PROJECT_URL` to the respective Blob URLs.

1. Run `npx vercel login` and `npx vercel link` to select your account/project.
2. Create a **public Blob store** in the project's Storage tab and connect it to Preview and Production. This creates `BLOB_READ_WRITE_TOKEN`.
3. Make that token available locally without overwriting your `.env` (for example, add it to `.env`), then run `npm run vercel:upload-sample`. Set the printed URL as `DEFAULT_PROJECT_URL` in Vercel. The script validates the complete archive before uploading and uses a new URL for each snapshot. To replace the sample project later, export the desired project from the app and run `npm run vercel:upload-sample -- path/to/project.sparko`. Run `npm run vercel:upload-default` and set `DEFAULT_VIDEO_URL` to enable **Sample video**.
4. Set these server-side environment variables in Preview and Production:
   - `OPENAI_API_KEY`
   - `GEMINI_KEY`
   - `COMFY_CLOUD_API_KEY`
   - `BLOB_READ_WRITE_TOKEN` (provided by the store)
   - `DEFAULT_PROJECT_URL` (or `DEFAULT_VIDEO_URL` for a video-only sample)
   - `APP_PASSWORD` (a separate workspace password, not an API key)
5. Run `npm run deploy:preview`, or `npm run deploy:production` for production.

The deployed app requires the workspace password before granting upload tokens or making provider requests. The sample project archive is served by its public Blob URL. Temporary analysis uploads use random URLs in `transient/` and are deleted after retrieval or request cleanup. An interrupted browser can leave an upload behind; remove old `transient/` objects in Blob as needed. Only the configured Blob store is accepted for remote API inputs. Local runs do not need Blob or a password; the local chooser serves `examples/sample.sparko` automatically.

Do not prefix API secrets with `VITE_`. Redeploy after changing deployment environment variables. This is a single-workspace app; interstitials and panel sizes remain browser-local, and API credits are shared by users of the workspace password.

## Verification

```sh
npm run build
npm test
npm run test:e2e
```

Browser tests use installed Google Chrome. They cover playback, draggable drafts, persistence, subtitle toggling, viewport fit, resizing, real non-keyframe MP4 export with audio, real reference preparation, interstitial job recovery/cancellation, native playback across cuts, generated-media conversion on archive import, cache reuse, and composed-export frame counts and audio. Voice tests use synthetic audio, never your microphone. Unit tests cover frame mapping, reference bounds, legacy migration, job lifecycle, voice capture, provider adapters, and API validation. Provider responses and Comfy generation are mocked to avoid recurring paid jobs; media processing runs for real. `tests/fixtures/voice-answer.wav` is a locally generated Windows speech-synthesis fixture; `interstitial-reference.mp4` is a synthetic four-second validation fixture.

Project tests cover binary archive round trips, invalid/corrupt archives, fresh-browser import with remote assets blocked, reopening a disk project through Recent, subtitle/description persistence, and storage failures. IndexedDB stores working media, metadata and recent file handles; [zip.js](https://gildas-lormeau.github.io/zip.js/) packages and validates the project archive.

Media checks cover native playback of 25 fps sources without encoding, 24 fps reference conversion, variable frame spacing in the fallback converter, cancellation without partial assets, and reopening saved projects. Browser tests use a short source for most project flows; the local server can serve the real default episode directly.

Libraries: React, TypeScript, Vite, Mediabunny, `@mediabunny/aac-encoder`, `@zip.js/zip.js`, `@ricky0123/vad-web` (with ONNX Runtime Web), Express, Multer, Zod, dotenv, OpenAI SDK, Google GenAI SDK, Vercel Blob, and Lucide. `vite-plugin-static-copy` bundles the speech detection assets. Tests use Vitest, Supertest, and Playwright.
