# Sparko

A compact, single-page video workspace with generated interstitials. React renders the UI; independent controllers own playback and generation jobs. Mediabunny handles source inspection, reference clipping, and frame-based composition.

## Run locally

Requires Node.js 24 and a current Chrome or Edge for WebCodecs export support.

On Windows, run `powershell -ExecutionPolicy Bypass -File .\Start-Sparko.ps1` from this folder. The launcher installs dependencies if needed and starts the development server at **http://127.0.0.1:3000**. Keep its terminal open; Ctrl+C stops it. Add `-Port 3001` to use another port.

```sh
git lfs install
git lfs pull
npm install
npm run dev
```

Open **http://127.0.0.1:3000** and choose **Sample video** to open `examples/sample.mp4`. Create a project from a local video on the project chooser, or drag and drop a video. The story canvas connects source footage and generated interstitial clips with arrows.

Copy `.env.example` to `.env` if you do not already have one. Set `COMFY_CLOUD_API_KEY` for interstitial generation. Set `OPENAI_API_KEY` and `GEMINI_KEY` for their respective analysis and voice features; `COMFY_API_KEY` and `GEMINI_API_KEY` are also accepted. Keys are read only by the server and never bundled into the frontend. The existing `.env` is ignored by Git.

**All model IDs are in [`shared/constants.ts`](shared/constants.ts).** Change them there, then restart/redeploy; there are no model overrides in `.env`.

## Clip graph editing

The video player stays on top, with the clip timeline directly below and dockable Library and Inspector panels on the side. Opening a project fits all clips and wire reroutes on screen and starts paused at the first frame of the starting clip. The timeline is a graph of horizontal filmstrip clips. Every clip uses the same duration scale: a six-second clip is twice the width of a three-second clip. Drafts use their planned duration; completed clips use their actual playable duration. Each active clip displays a local playhead and timestamp. Click or drag its filmstrip to scrub, and drag its title to move it without changing playback order.

- **Connect clips:** drag an output handle onto another clip, or click the output followed by a destination input. Drag an existing arrow onto another clip to redirect it. A live wire previews the drag; Escape cancels. Selecting an arrow opens its destination and disconnect controls.
- **Library:** imported footage, generated media, WebVTT subtitles, interstitial types, and templates share one searchable panel. Filter by category, select footage to preview it, and drag or double-click a media asset to create another independent clip. Deleting timeline clips keeps their media in the Library, including unused assets in saved project archives.
- **Import videos:** use the Library's **Import assets** button or drop video files into the open editor. Each file becomes a separate source clip with its own media and duration. Importing creates no arrows, including when files are dropped onto an existing arrow. Batch import is one undoable action, and an invalid file or cancelled preparation leaves the graph unchanged. Imported videos and any retained originals are included in project files. Importing a WebVTT file attaches it as the subtitle track and keeps it in the Library.
- **Insert clips:** split a source clip at its playhead, then use the **+** on the new arrow to insert an interstitial. **+ Interstitial** creates an independent clip; when a connection is selected it inserts there.
- **Drag interstitials and templates:** drag from the Library or the toolbar menus. A clip preview shows the exact placement at the current zoom. Drop onto empty canvas to place independently, onto an arrow to insert, or onto a clip to connect after it. Existing clips and the viewport stay in place. Escape cancels; keyboard users can focus a card and press Enter to add at the selection. Media assets always create separate clips.
- **Arrange panels:** the Library and Inspector use the animation editor's collapsible panel stacks. Drag headers vertically to reorder, or to the side to snap into another column. Resize between panels or columns; double-click a divider to balance sizes. Escape cancels a drag or resize. Alt + arrow keys on a panel header moves it; arrow keys on dividers resize. Right-click a header to collapse or dismiss; **Panels** reopens panels or resets the workspace. Layout preferences stay in this browser. Narrow screens stack the panels below the player and timeline.
- **Cut/split:** enable the scissors tool with **C** and click a filmstrip to cut at that frame. **V** returns to selection. Right-click a clip for **Split here**, duplicate, delete, and template actions, or use **S** at the playhead. Splitting preserves the media and transfers outgoing connections to the second half; a split conditional or loop runs its first half once and keeps its behavior on the second half.
- **Simple** clips play once and follow their next connection. **Looped** clips repeat until Continue is chosen or for a configured number of iterations. **Conditional** clips choose their destination from editable choices and accepted text alternatives; their fallback can repeat, end playback, or lead to another clip. Choices take effect at a clip boundary.
- **Wire editing:** drag between clip sockets in either direction. Drag an input connection or a wire to reconnect it; drop on empty canvas to detach. Escape cancels. Double-click a wire (or use its right-click menu) to add reroute points, then drag them to reshape it. Delete or double-click a point to remove it. Wire shapes are saved with the project; Clean up layout resets them.
- **Reference matching:** generated clips retain the exact reference assets and cut times used for their saved render. A red wire flags a mismatched reference after trimming, replacing media, or reconnecting. Playback still proceeds; the Inspector explains the mismatch. Blue sections on generated filmstrips show saved reference footage, and purple shows the playable generated body. References extend outside the body on the same time scale; scrubbing and splitting remain relative to the playable portion.
- **Crossfades:** click the dissolve button on a connecting arrow to edit that connection in the Inspector. Each connection has its own duration; 0 makes a cut. Generated entry fades finish at the cut using the saved opening reference, and bridge exit fades begin at the cut using the ending reference. Fades are capped to matching reference footage; rewired or trimmed clips without a matching reference use a cut. Clips have no fade handles or overlays. Clip durations remain unchanged. **Options → Interstitial crossfades** is the master preview toggle. After generation, the Inspector shows actual reference/generated time ranges and the portion used in the timeline.
- **Templates:** Question & response, Loop until ready, and Simple scene are starting arrangements of ordinary editable clips. There is no call-response parent or special group. Shift-click interstitials and choose **Save selected clips as template** to reuse their prompts, types, fades, and internal connections. Templates are saved with the project; each instance starts with independent draft settings.
- **Infinite canvas:** clips can move left or above zero; positions are saved with the project. Pan with the **Hand tool (H)**, middle-mouse drag, **Space + drag**, or the wheel/trackpad. Ctrl/Cmd + wheel zooms around the pointer. **Fit all** shows the whole graph; **Shift+F** fits the selected clips. Clip height and text size stay constant during zoom and fitting. **Follow playhead** moves the view as playback advances.
- **Selection:** drag empty canvas to draw a selection box. Shift adds to the selection; Ctrl/Cmd toggles the enclosed clips. Drag a selected clip title to move the selected clips together. Click empty canvas to deselect. Escape cancels an unfinished move or selection. Clip text does not create browser text-selection highlights.
- **Cleanup:** right-click the canvas or a clip and choose **Clean up layout**, or press **A**. This arranges clips and frames the result without changing connections or media timing; one Undo restores the previous positions. The right-click menu also offers **Fit all** and **Fit selected**.
- **Editing:** duplicate one or several clips, trim source in/out points, split source footage, rename clips, change interstitial types, and choose the story's entry clip. Deleting a clip removes its connections; disconnecting an arrow retains both clips.
- **Undo/redo:** graph edits, template insertion, names, prompts, settings, and deletion support history and autosave. Up to 100 edits are retained for the session. Generation jobs retain their latest status and media; undoing deletion can reuse retained media.

| Shortcut | Action |
| --- | --- |
| Space | Play / pause |
| N (or P) | New simple interstitial |
| S | Split selected clip at its playhead |
| C / V | Cut tool / selection tool |
| H | Hand tool for panning |
| Space + drag / middle-mouse drag | Pan freely |
| Shift + F | Fit selected clips |
| Home on empty canvas | Fit all clips |
| A | Auto layout |
| Ctrl/Cmd + D | Duplicate selected clips |
| Shift-click | Add or remove a clip from the selection |
| Delete / Backspace | Delete selected clips or connection |
| Escape | Cancel connecting or close the active menu |
| Left / Right on a filmstrip | Step one edit frame; Shift steps one second |
| Home / End on a filmstrip | Seek to that clip's first / last frame |
| Ctrl/Cmd + Z | Undo |
| Ctrl/Cmd + Shift + Z / Ctrl + Y | Redo |

Text fields keep their normal editing shortcuts. Playback also retains volume/mute, speed, skips, fullscreen, picture-in-picture where supported, and WebVTT subtitles. Canvas height and inspector width are resizable and remembered locally. Narrow screens stack the inspector below the player and graph. Generation feedback occupies reserved space or overlays inside clips, so loading does not push controls down.

## Generation and compatibility

Select an interstitial to edit its prompt, reference ranges, duration, reference clip, and generation method. **Extend previous clip** needs an upstream reference; **Seamless loop** uses a reference to generate repeating footage; **Bridge to next clip** also needs a ready destination clip. Reference dependencies follow the chosen reference clip, independently of playback loops. Changing upstream footage marks dependent generated clips as needing regeneration.

Generation and regeneration run through the existing Comfy job controller. Settings remain editable while a job runs and are saved for the next request. The previous result remains playable until its replacement is ready. Progress, cancellation, failed-job recovery, separate preview, and full-output download remain available inside the inspector.

Older pin-based and call-response projects migrate to individual clips and arrows on opening, retaining their generated media and branch connections. Legacy group records are not exposed in the editor. New archives use version 3; versions 1 and 2 remain readable. Templates, positions, routing, reference selection, and connection crossfade durations are saved.

Source videos that the browser and Mediabunny can decode retain their native format and frame rate, including the 25 fps example episode. Unsupported sources use the existing H.264/AAC preparation path, capped at 1080p by default. `TIMELINE_FPS` remains the 24 fps edit clock for clip boundaries, stepping, and references. Graph playback uses the shared Mediabunny canvas and audio renderer, preloading upcoming clips and blending video and audio at joins. Source captions retain source timestamps and stay off generated footage. Description and voice APIs remain available internally; their panels are currently not shown in this editor.

## Local projects and portable project files

Videos opened from the project chooser, completed interstitial videos, and WebVTT subtitles are stored as Blobs in **IndexedDB**. Browser-playable source media is retained unchanged. An unsupported source uses a compatible working copy while retaining its original. Cancellation or storage failure leaves the previous project intact. Project metadata autosaves to a browser working copy; **Save project** writes the complete project to a portable file. Remote generated clips are downloaded once and subsequently read locally.

**File → Export project** downloads a self-contained `.sparko` file. It is a ZIP archive containing a versioned `project.json` manifest and all referenced media bytes: the prepared source, its retained original, generated videos, and subtitles. It also includes the clip graph, templates, per-clip fades, reference ranges, prompts, generation states and job IDs, plus the description tool's range, provider, focus and latest caption/description. Generated videos retain their reference footage and exact inserted-section bounds. API keys, workspace passwords and temporary microphone recordings are not project content and are never included.

**Open project file** on the project chooser (or dropping a `.sparko` file onto the app) validates the archive, checks media boundaries, and opens it as a local working project. A native file picker keeps the file handle for subsequent saves and Recent; drag and drop or the fallback input require **Save as new file** to establish a file handle. Asset IDs are remapped so importing the same archive twice cannot mix their media. ZIP checksums detect damaged files; missing assets, unsupported versions and invalid metadata are rejected. Imported media is committed in one IndexedDB transaction. Opening and exporting show progress and support cancellation. Storage/quota errors leave the previous project available.

Exports are snapshots taken when export starts. Unfinished remote jobs retain their job IDs and can resume with the original provider account. Interrupted preparation returns to a draft. Project export copies stored originals without encoding. Opening a `.sparko` file checks every saved generated result, retained result, and branch asset against the native source. Older archives with both a 24 fps working copy and a playable original restore the original source and reconnect its timeline scenes. Mismatched generated media is converted before activation, with progress and cancellation. Compatible clips are reused. Conversion changes playback copies only; saved clip bounds, originals, and generation references retain their meaning.

The current archive limit is **8 GB of media** and **8 MB of metadata**. Media uses uncompressed ZIP entries to avoid spending time recompressing MP4s. Browser storage belongs to this browser profile and origin; clearing site data removes it, and browsers may evict it under storage pressure. Export project files for portable backups. Saved assets can play without the original local file or provider URL, once the app itself is loaded; this is not an offline installation of the app. Panel layout and transient playback controls remain workspace preferences.

## Interstitial generation and playback

`start_range` is the tail of the chosen reference clip; bridge generation also uses `end_range` from the destination clip. Ranges align to the project's 24 fps frame grid. The inspector shows the effective reference range and explains unavailable or stale dependencies. H3 bridge generation requires at least 1.625 seconds of usable context on each side.

Generated duration is saved per draft, including in exported projects. Its default and limits (6 seconds, 5–13 allowed) and reference limits are configured in `shared/constants.ts`. Older projects without a duration use the six-second default. Mediabunny exports an H.264/AAC reference MP4 capped at **960 pixels on its longest edge** and 50 MB. These are Sparko limits, not a universal Comfy Cloud upload specification. `POST /api/comfy/interstitials` validates the requested duration, file and frame-aligned insertion coordinates before submitting the workflow. The generated section becomes the interstitial clip's playable body. Failed interstitials stay editable with the error visible; **Retry** uses the updated settings without a separate reset step.

Comfy returns a video with both context ranges and the generated middle. Sparko stores the generated section's exact bounds and inserts only that section. A completed interstitial's **Download full video** action saves the entire generated MP4, including both reference ranges and audio, directly from the cached asset without re-encoding. Preparation shows measured progress; upload, queue position, generation and saving/loading the result have separate waiting states. Cancellation, failed-job retry, and saved draft fields are supported. Retry reuses an already returned video if only loading failed and its settings are unchanged; failed generations and edited drafts submit a new job after retiring any previous active job. Once downloaded into IndexedDB, the result no longer depends on the provider's URL retention policy.

The interstitial editor stays editable in every state, including preparation, generation, loading and reopening saved results. **Generate** creates the first scene, **Regenerate** replaces a completed scene, and **Retry** recovers from a failure or cancellation without a reset step. Each job saves a snapshot of its submitted settings; edits made while it runs are saved for the next generation and cannot change the in-flight request. An unchanged failed download offers **Retry loading** without another generation. Submitted settings and pending edits are included in project files.

The existing scene stays playable and downloadable until its replacement is saved and validated, including after a failure or cancellation. Retained videos are included in IndexedDB saves and project archives. Loading is visible directly on the timeline: a spinner inside the filmstrip before the first result or during regeneration. Hovering shows the current stage and preparation percentage or queue position when available. The spinner clears on completion, failure or cancellation.

`TimelineComposition` keeps the existing 24 fps edit grid for saved anchors and clip boundaries. Playback is timestamp based: the native source keeps its own frame cadence, and generated clips match its nominal frame rate and dimensions. No source frames are encoded for preview. Variable-frame-rate source timestamps remain native. Explicit composed exports still sample the edit grid and encode one video/audio stream.

`NativeTimelinePlayback` plays the original source and prepared generated media through preloaded native elements. Seeking positions the relevant clips directly. Crossfades blend their opacity and volume over the project's selected transition interval. `GeneratedPlaybackMedia` converts only mismatched generated assets and caches the results, preserving their original files for downloads and archives. `TimelineStream.exportMp4` remains an explicit composed-export helper, capped at 1080p; it is not used for playback.

Playback starts **after Comfy finishes generation**; progress events show workflow stages and sampler steps, while the playable video is available after completion. Scene boundaries are exact on the project frame grid; visual continuity of the generated content still depends on the model.

The following linear composition API is retained for existing integrations, with no export UI; it does not traverse the new branching graph.

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

Interstitial drafts use Comfy Cloud H3 workflows. The selected H3 workflow and exact generated-section bounds are included in project files. Regeneration retains the previous video until a replacement is ready and supports retry, independent preview, timeline thumbnails/loading feedback, and downloading the whole output. Older project archives containing Fal-generated media remain readable; pending Fal jobs cannot resume.

Set `COMFY_CLOUD_API_KEY` in `.env`, then restart `npm run dev`. `COMFY_API_KEY` is also accepted. `COMFY_BASE_URL` defaults to `https://cloud.comfy.org`; it can point to a compatible HTTPS Comfy API deployment. Set the same server-only variables in Vercel and redeploy there. Run `npm run comfy:check` to verify authentication, required nodes, and H3 model availability without submitting a generation. Model filenames and sampling settings live in `shared/constants.ts`.

This implementation uses the [Comfy API v2](https://docs.comfy.org/api-reference/v2/overview) and native H3 video/audio latents with [MaskVidExperiments](https://github.com/drozbay/MaskVidExperiments). The specific `MiniMaxH3ContexMaskedAVBridge` custom node from the linked community workflow was absent from the managed Cloud catalog during setup. Instead, this graph independently encodes both context clips, places them at opposite ends of an H3 latent, and masks the missing middle using available Cloud nodes. When source audio exists it is conditioned and masked too; otherwise H3 generates audio. Image quality and boundary continuity need evaluation with actual generations.

H3 requires frame counts of `5 + 17k` at 24 fps. Context ranges round down to usable model windows, and total duration rounds up to the next valid frame count. A six-second draft with two-second reference ranges therefore uses 39 frames (1.625 seconds) per side and generates 148 frames (6.167 seconds). The panel shows these effective values before generation. At least 1.625 seconds of source footage must exist on both sides. Sparko caps the full target at 362 frames and 960 pixels on the longest edge, then rounds dimensions to multiples of 32. Comfy's [H3 native guide](https://docs.comfy.org/tutorials/video/minimax/minimax-h3-native) describes a 768-pixel **short edge** for the native canvas; that is a model canvas recommendation, not a Cloud input upload cap. Only the generated middle is inserted into Sparko's timeline; original footage remains the source outside it.

Crossfade values are saved independently on each clip in the graph. The Options menu retains a master preview toggle. The legacy linear composition export API retains its original transition model; rendering a chosen graph path to MP4 is not exposed in the editor.

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
| `src/features/story-flow/` | Clip graph model, filmstrip canvas, inspector, templates, routing, generation dependencies and migration |
| `src/features/call-response/` | Shared branching playback engine and legacy project adapters |
| `src/features/timeline/` | Shared filmstrip thumbnails and legacy timeline components |
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

The sample project is [`examples/sample.sparko`](examples/sample.sparko), a portable project with `sample.mp4`, eight completed interstitials, two drafts, and a saved 14-frame (about 0.6-second) crossfade. It is tracked with Git LFS; run `git lfs pull` before uploading from a fresh checkout. The archive is approximately 145 MiB.

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

Browser tests use installed Google Chrome. The new `story-flow.spec.ts` suite covers proportional clip widths, scrubbing, splitting, insertion, independent fades, templates, arrow dragging and reconnection, undo/redo, branching playback, stable narrow-screen loading, generated media save/reopen, and legacy sample migration. Older suites retain coverage of legacy components and APIs; UI tests that specifically target removed pins or groups require migration to the graph workflow. The existing media suites cover playback, persistence, subtitle toggling, viewport fit, resizing, real non-keyframe MP4 export with audio, real reference preparation, interstitial job recovery/cancellation, native playback across cuts, generated-media conversion on archive import, cache reuse, and composed-export frame counts and audio. Voice tests use synthetic audio, never your microphone. Unit tests cover frame mapping, reference bounds, legacy migration, job lifecycle, voice capture, provider adapters, and API validation. Provider responses and Comfy generation are mocked to avoid recurring paid jobs; media processing runs for real. `tests/fixtures/voice-answer.wav` is a locally generated Windows speech-synthesis fixture; `interstitial-reference.mp4` is a synthetic four-second validation fixture.

Project tests cover binary archive round trips, invalid/corrupt archives, fresh-browser import with remote assets blocked, reopening a disk project through Recent, subtitle/description persistence, and storage failures. IndexedDB stores working media, metadata and recent file handles; [zip.js](https://gildas-lormeau.github.io/zip.js/) packages and validates the project archive.

Media checks cover native playback of 25 fps sources without encoding, 24 fps reference conversion, variable frame spacing in the fallback converter, cancellation without partial assets, and reopening saved projects. Browser tests use a short source for most project flows; the local server can serve the real default episode directly.

Libraries: React, TypeScript, Vite, Mediabunny, `@mediabunny/aac-encoder`, `@zip.js/zip.js`, `@ricky0123/vad-web` (with ONNX Runtime Web), Express, Multer, Zod, dotenv, OpenAI SDK, Google GenAI SDK, Vercel Blob, and Lucide. `vite-plugin-static-copy` bundles the speech detection assets. Tests use Vitest, Supertest, and Playwright.
