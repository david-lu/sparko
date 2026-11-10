# Sparko

A compact media workspace with AI image, video, and audio generation. React renders the UI; independent controllers own playback and generation jobs. Mediabunny handles source inspection, reference clipping, and frame-based composition.

For the proposed subscription streaming service, see the [streaming architecture README](docs/streaming-architecture/README.md). It covers business account setup, AWS hosting, Mediabunny playback, Stripe subscriptions, scaling and cost assumptions, current limitations, and the implementation roadmap.

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

Copy `.env.example` to `.env` if you do not already have one. Set `COMFY_CLOUD_API_KEY` for H3 video generation, `FAL_KEY` for image generation and `ELEVENLABS_API_KEY` for dialogue, music and sound effects on the timeline. Set `OPENAI_API_KEY` for prompt enhancement and OpenAI analysis/voice features, and `GEMINI_KEY` for Gemini analysis/voice features; `COMFY_API_KEY` and `GEMINI_API_KEY` are also accepted. Keys are read only by the server and never bundled into the frontend. The existing `.env` is ignored by Git.

To fetch environment variables from an existing Vercel project:

```sh
npx vercel login
npx vercel link # Select the existing Sparko project; only needed once per checkout.
npm run vercel:env # Development variables by default.
npm run vercel:env -- production # Or: preview
```

The script pulls into the repository's `.env`, saving any previous file as `.env.backup-<timestamp>-<id>`. Failed downloads leave `.env` unchanged; temporary files and backups are ignored by Git and excluded from deployments. Restart the development server after pulling. The [Vercel CLI](https://vercel.com/docs/cli/env) preserves local-only entries when merging, but cannot download unreadable Secret values; keep those values locally or fill in the placeholders it creates. Pulling does not create or update variables on Vercel.

**Comfy model IDs are in [`shared/constants.ts`](shared/constants.ts); the fal image and ElevenLabs audio model catalog is in [`shared/asset-generation.ts`](shared/asset-generation.ts).** Change them there, then restart/redeploy; there are no model overrides in `.env`.

## Clip graph editing

Use **Preview** in the top bar to view the project in a read-only video player, and **Edit** to return to the workspace. Preview hides the graph and panels and disables editing shortcuts and file imports. The seek bar marks scenes in blue, loops in amber, and choices in purple; hover or scrub to see clip names. Playback, captions, speed, volume, fullscreen, and audience answer buttons remain available. The bar follows the current branch and shows one pass through loops, so interactive running times are approximate. Ungenerated scenes retain their reference-frame preview and are labeled in the player controls. Switching modes retains playback, selection, and workspace layout.

The video player stays on top, with the clip timeline directly below and dockable Library and Inspector panels on the side. Opening a project fits all clips and wire reroutes on screen and starts paused at the first frame of the starting clip. The timeline is a graph of horizontal filmstrip clips. Every clip uses the same duration scale: a six-second clip is twice the width of a three-second clip. Drafts use their planned duration; completed clips use their actual playable duration. Each active clip displays a local playhead and timestamp. Click or drag its filmstrip to scrub, and drag its title to move it without changing playback order.

- **Connect clips:** drag an output handle onto another clip, or click the output followed by a destination input. Drag an existing arrow onto another clip to redirect it. A live wire previews the drag; Escape cancels. Selecting an arrow opens its destination and disconnect controls.
- **Library:** import images, video, and audio files, or drop files and folders into the Library. Imports keep their nested folders and do not add timeline clips. Search or filter by media type. Selecting an asset shows its preview in the Inspector; clicking empty Library space clears the selection.
- **Sound belongs to clips:** there are no project-wide audio layers. Add music, voiceover or effects to individual clips, for example as audio clips on the timeline or as audio tracks in a video's generation timeline. Projects and project files saved with the former **Audio layers** still open (archive version 6 remains readable): their layer placements are dropped, and each layer's audio file stays in the Library as an ordinary audio asset.
- **Capture a frame:** in Edit mode, right-click the video canvas and choose **Create image from playhead**. Opening the menu pauses playback; the displayed video frame becomes a PNG image in the Library at full playback resolution, including current framing and transitions. Captures exclude player controls and text overlays, support Undo, and can be dragged into generation inputs like other images. Keyboard users can focus the video preview and press **Shift+F10** to open the same menu.
- **Create generations:** add a video, image, or audio clip on the timeline. Its Inspector owns the prompt, references, generation settings, and playback controls. **Generate a new version** adds a recipe to an existing clip and keeps its current media until a new output is ready. The Library stores reusable media assets and their saved generation details; volume, trim, and other playback controls belong to each timeline placement. Expand **Generated video**, **Generated image**, or **Generated audio** to inspect the saved output and submitted settings.
- **Models:** video generation uses Comfy H3; image generation supports Nano Banana 2, Nano Banana Pro, FLUX.2 Pro, FLUX.2 Max, Seedream 4.5, and Ideogram 3.0; audio uses ElevenLabs (see **Audio** below). Each model lists its supported reference types. Drag Library assets onto thumbnail input slots, or drop files directly. Single inputs accept a replacement drop; incompatible media is rejected. Ideogram currently supports text-to-image; the other image models also support image editing. Previous outputs remain available while regenerating, and each saved version retains the exact submitted settings. **Check result** retries retrieval without submitting another generation. Saved Kling outputs remain readable in older projects; choose **Use H3** to continue generating from their clips.
- **Enhance image and audio prompts:** the Inspector’s **Enhance prompt** uses the existing OpenAI connection and the selected model author’s prompting rules. The adjacent guide link identifies the source: [Google Nano Banana](https://ai.google.dev/gemini-api/docs/image-generation#prompt-guide), [BFL FLUX.2 Pro/Max](https://docs.bfl.ai/guides/prompting_guide_flux2), [ByteDance Seedream](https://console.byteplus.com/ark/region:ap-southeast-1/docs/seedream-4-0-5-0-prompt-guide), or [Ideogram](https://docs.ideogram.ai/prompting/prompt-structure) for images (reviewed November 3, 2026), and ElevenLabs’ [Eleven v4/v3 audio tag guide](https://elevenlabs.io/docs/overview/capabilities/text-to-speech/best-practices), [Eleven Music best practices](https://elevenlabs.io/docs/overview/capabilities/music/best-practices) or [sound effects guide](https://elevenlabs.io/docs/overview/capabilities/sound-effects) for audio (reviewed November 10, 2026). Image previews inform the rewrite; audio/video contents are not inspected. Enhancement preserves the draft on failure, supports Undo, and cancels when its model, prompt, references, or settings change. Image and video prompt requests continue when clips are deselected; returning to a clip restores its enhancement or reference-analysis progress and cancel control. Each result updates its original clip. Removing the clip or closing the project cancels its request. Ideogram’s automatic Magic Prompt is disabled so it uses the visible prompt.
- **Select and delete assets:** use Shift or Ctrl/Cmd to select multiple Library items. Right-click a selected item to keep the selection and choose **Move to folder** or **Delete selected assets…**; Delete and Backspace also work on the whole selection. The delete dialog lists timeline clips, generation inputs, submitted references, templates, and saved versions using the selected assets. Remove or replace those uses before deleting. Running generations are cancelled first; a cancellation failure keeps the selected assets. One Undo restores the entire deleted batch. Single assets keep their individual menu actions.
- **Audio:** audio clips are generated directly with ElevenLabs (`ELEVENLABS_API_KEY`). Choose a type in **Model**:
  - **Dialogue · ElevenLabs v4** (Text to Dialogue): write one turn per line as `Name: line`, using names from **Characters**. Lines without a name continue the previous turn. Each speaker uses their character’s voice; scripts can use up to 10 voices and 2,000 spoken characters. Square-bracket audio tags such as `[whispers]` or `[laughs]` direct delivery. **Delivery** sets stability (Creative, Natural or Robust), and **Language** and **Seed** are optional. The speaker chips under the script insert a character’s name; **Add character** opens the character dialog.
  - **Music · Eleven Music v2.5**: 3 seconds to 5 minutes or **Auto**, with an **Instrumental only** option. ElevenLabs rejects prompts that name artists or songs or quote copyrighted lyrics; the error includes ElevenLabs’ suggested prompt. The Music API needs a paid ElevenLabs plan.
  - **Sound effects · ElevenLabs v3**: 0.5–30 seconds or **Auto**, **Prompt influence** (0–100%, higher follows the prompt more literally) and **Seamless loop**. Prompts can be up to 450 characters.
  ElevenLabs answers synchronously, so the server streams the audio straight back. Cancelling stops the request, and a generation interrupted by a reload returns to draft. Dialogue versions record the voice each speaker used. Stable Audio and fal-hosted sound effects are retired: drafts that used them switch to ElevenLabs Music and Sound effects when the project opens, and saved versions remain readable.
- **Characters:** the Project inspector’s **Characters** section lists the project’s cast. Each character has a name, a **How they sound** description (age, accent, pitch, pace, timbre, attitude) and an ElevenLabs voice. **Choose voice** searches the voices in your ElevenLabs account and plays their previews; **Design voice** creates three voices from the description to compare, and the chosen one is saved to your ElevenLabs account, named after the character, when you save. **Enhance** rewrites the description following ElevenLabs’ [voice design guide](https://elevenlabs.io/docs/eleven-creative/voices/voice-design). Audio prompt enhancement receives each character’s description, so dialogue tags suit each voice and sound effect or music prompts describe a character’s laugh, roar or singing voice instead of naming them. Voice IDs are never sent to OpenAI. Characters are undoable and saved with the project; projects with characters or ElevenLabs generations use archive version 9. The API key needs the Text to Speech, Sound Effects, Music, Voices (read and write) and Voice Generation permissions.
- **Import timeline clips:** drop videos or images onto the canvas or use its import control to create independent source clips. Drag or double-click a Library video or image to reuse it on the timeline. Still images hold one frame without audio, default to one second, and have an editable **Duration (s)** in the Inspector. New image generation clips also start as one-second placeholders. Drag their trim handles to change the duration on the 24 fps timeline. Deleting a timeline clip keeps its media in the Library.
- **Insert clips:** use the **Video** card in Add clips, or a timeline context menu. Drag onto empty canvas to place independently, onto an arrow to insert, or onto a clip to connect after it. Templates preserve groups of clips and their connections. Keyboard users can focus a card and press Enter to add it at the selection.
- **Arrange panels:** the default player, timeline, and sidebar layout stays available. Enable **Window → Arrange all panels** to dock any panel beside, above, below, or in a tab group with another panel. Panels can also float, move, resize, and maximize. Drag a tab to dock it; use the floating grip or arrow keys to move floating panels. **Window → Reset workspace** restores the original arrangement. Positions persist in this browser; **Lock workspace** prevents layout changes.
- **Cut/split:** enable the scissors tool with **C** and click a filmstrip to cut at that frame. A successful cut returns to selection; **V** or **Esc** cancels the tool. Right-click a clip for **Split here**, duplicate, delete, and template actions, or use **S** at the playhead. Splitting preserves the media and transfers outgoing connections to the second half; a split conditional or loop runs its first half once and keeps its behavior on the second half.
- **Simple** clips play once and follow their next connection. **Looped** clips repeat until Continue is chosen or for a configured number of iterations. **Conditional** clips choose their destination from editable choices and accepted text alternatives; their fallback can repeat, end playback, or lead to another clip. Choices take effect at a clip boundary.
- **Wire editing:** drag between clip sockets in either direction. Drag an input connection or a wire to reconnect it; drop on empty canvas to detach. Escape cancels. Double-click a wire (or use its right-click menu) to add reroute points, then drag them to reshape it. Delete or double-click a point to remove it. Wire shapes are saved with the project; Clean up layout resets them.
- **Reference matching:** generated clips retain the exact reference assets and cut times used for their saved render. A red wire flags a mismatched reference after trimming, replacing media, or reconnecting. Playback still proceeds; the Inspector explains the mismatch. Blue sections on generated filmstrips show saved reference footage, and purple shows the playable generated body. References extend outside the body on the same time scale; scrubbing and splitting remain relative to the playable portion. Selecting a generation highlights its source ranges across all contributing clips: blue for Start and green for End. Drafts show the requested windows; completed clips show the saved render’s actual windows, even after settings or connections change. Loop endings highlight the held final frame.
- **Crossfades:** click the dissolve button on a connecting arrow to edit that connection in the Inspector. Video and audio have independent durations; 0 makes a cut. Fades use available opening or ending footage regardless of whether the saved references match the connected clips. Without extra reference footage, the dissolve is centered on the cut; video holds at media boundaries and missing audio is silent. Clip durations remain unchanged. Selecting a transition highlights its actual ranges on both connected clips, with video above audio and colors matching the connection line. Fade regions are hidden when no transition is selected. **Options → Interstitial crossfades** is the master preview toggle. After generation, the Inspector shows actual reference/generated time ranges and the portion used in the timeline.
- **Templates:** Question & response, Loop until ready, and Simple scene are starting arrangements of ordinary editable clips inside a named group frame, visible during dragging and after placement. Shift-click interstitials and choose **Save selected clips as template** to reuse their prompts, types, fades, and internal connections. Templates are saved with the project; each instance starts with independent draft settings.
- **Groups:** select clips, right-click one and choose **Group selection** (or press Ctrl/Cmd + G). Drag a group header to move it with its clips, or resize a selected frame using its corner. Right-click the header to rename, change color, fit contents, add selected clips, duplicate, save as a template, or remove the group while keeping its clips and connections. Individual clips can be removed from a group in the Inspector or their context menu; a group keeps its frame when its last clip is removed. Group edits support undo and are saved with the project.
- **Comments:** choose **Comment tool** (Shift+M) beside Cut, or right-click and choose **Comment on this moment** or **Add comment**. While the tool is active, a ghost pin follows the pointer and shows the exact time it would mark. Clicking a clip pins the comment to that moment, below the clip's filmstrip; within a few pixels of the playhead it snaps to the playhead's frame. Clicking empty canvas pins it to that spot. Pins show the opening words of their comment, shortening before the next pin; only when the timeline is zoomed out below 50% do they collapse to icons. Hovering shows more of the text. Opening a clip comment moves the playhead to its moment. Write in the popover beside the pin; Ctrl/Cmd + Enter saves, Escape discards, and clicking elsewhere keeps what you typed. Choose a pin color, resolve, reopen, or delete a comment from its popover; resolved pins are dimmed and struck through. Drag a pin onto a clip moment or empty canvas, or use the arrow keys to nudge it one frame (Shift: one second); Delete removes a focused pin. Clip comments follow the clip's media: trims, splits and joins keep them on the same frame, and a moment hidden by a trim keeps a dashed pin at the clip's edge. Deleting a clip leaves its comments where they were on the canvas. Comment edits support undo and are saved with the project; projects with comments use archive version 8 so older builds cannot silently drop them.
- **Infinite canvas:** clips can move left or above zero; positions are saved with the project. Pan with the **Hand tool (H)**, middle-mouse drag, **Space + drag**, or the wheel/trackpad. Ctrl/Cmd + wheel zooms around the pointer. **Fit all** shows the whole graph; **Shift+F** fits the selected clips. Clip height and text size stay constant during zoom and fitting. **Follow playhead** moves the view as playback advances.
- **Selection:** drag empty canvas to draw a selection box. Shift adds to the selection; Ctrl/Cmd toggles the enclosed clips. Drag a selected clip title to move the selected clips together. Click empty canvas to deselect. Escape cancels an unfinished move or selection. Clip text does not create browser text-selection highlights.
- **Preferences:** **Options → Preferences** adjusts pinch zoom sensitivity from 0.5× to 5×, with a more responsive 3× default. Changes apply immediately to trackpad pinch and Ctrl/Cmd + scroll and stay saved on this device.
- **Cleanup:** right-click the canvas or a clip and choose **Clean up layout**, or press **A**. Nearby loose clips follow the main path's movement; distant disconnected clips move into nearby free space. Cleanup preserves connections, media timing, pan and horizontal zoom; one Undo restores the previous positions. Use **Fit all** or **Fit selected** to frame the result.
- **Editing:** duplicate one or several clips, trim source in/out points, split source footage, rename clips, change interstitial types, and choose the story's entry clip. Deleting a clip removes its connections; disconnecting an arrow retains both clips.
- **Undo/redo:** graph edits, template insertion, names, prompts, settings, and deletion support history and autosave. Up to 100 edits are retained for the session. Generation jobs retain their latest status and media; undoing deletion can reuse retained media.

| Shortcut | Action |
| --- | --- |
| Ctrl/Cmd + S | Save project (choose a file on the first save) |
| Ctrl/Cmd + Shift + S | Save project as a new file |
| Space | Play / pause |
| N (or P) | New simple interstitial |
| S | Split selected clip at its playhead |
| C / V | Cut tool / selection tool |
| H | Hand tool for panning |
| Shift + M | Comment tool |
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

Select an interstitial to edit its prompt, reference ranges, duration and images. Start takes footage from preceding connected clips, and End takes footage from following clips. Reference windows span multiple videos and still images: a four-second Start window after a two-second clip also takes two seconds from the clip before it. Windows stop at the available footage; ambiguous paths require an explicit selection. Each side has a **Choose other videos / images** toggle for an ordered Library sequence of up to 16 assets. Add multiple files or drag selected Library assets, reorder them with the arrows, and set video In/Out ranges or image durations. Start uses the tail of the sequence; End uses its beginning. Toggling the selection off retains the saved sequence. Enabling **Loop** replaces these controls with a shared **Loop ref** for generation. Changing connected reference footage marks dependent generated clips as needing regeneration.

**Upscale to 2K (optional)** is a separate step after generation. Every render is native H3; generating never requires the 2K partner node. Once a video exists, **Upscale to 2K** below **Generate** sends that render's complete saved MP4, including its reference sections, and its exact prompt through Comfy's official **MiniMax H3 Regenerate to 2K** partner node, which calls MiniMax's **H3-Regenerate-2K** service. The pass needs only the video and prompt text, not the original H3 latents or text embeddings, so it can run at any time after the native render. Progress appears inside the button and in a reserved status line; the cancel button beside it stops the remote job. The 2K video belongs to the render it was made from: open the generation timeline and choose the **Upscaled** tab, beside **Input** and **Generated**, to preview it on the same frame clock. The Library lists it as *Clip · 2K*. Regenerating replaces the native render and with it the 2K version, which you can upscale again. Story playback continues to use the native render. Submitted 2K jobs survive reloads and resume without paying again; if checking a submitted job fails, the retry button beside **Upscale to 2K** checks it again. 2K videos are saved in browser projects and project files. Exact-frame keyframes are restored into the 2K video from the native render. Projects that saved the retired **Enable 2K regeneration** setting now generate natively; their earlier 2K renders stay as they are.

Generation and regeneration run through the existing Comfy job controller. Settings remain editable while a job runs and are saved for the next request. The previous result remains playable until its replacement is ready. Progress, cancellation, failed-job recovery, separate preview, and full-output download remain available inside the inspector.

**Audio tracks in the generation timeline:** choose **Add audio track** in the generation timeline's toolbar, then add sounds at the playhead from the track's panel or drag audio from the Library onto a track. Audio dropped anywhere else on the timeline starts a new track. Each track can be renamed, muted, or deleted. Each sound can be moved by dragging, with the arrow keys, or by editing **Start**, trimmed with **Source in** and **Source out**, set to its own volume, or deleted. Sounds on one track never overlap; use more tracks to layer them (up to 8 tracks of 64 sounds each). The **Input** and **Generated** tabs each have their own tracks:

- **Input** tracks are mixed into the input movie H3 receives. In the generated section, their spans keep input audio in the audio mask (the video mask is unchanged), so the model keeps that sound and generates the picture to match it, for example lip-sync to a recorded line. The audio columns at each seam between a reference and the generated section always regenerate, even where kept sound or a timeline video touches the seam. Editing input tracks marks the clip as edited, like any other input.
- **Generated** tracks play over the rendered video wherever it plays: the generation preview, the 2K tab, and story playback, including loops, repeats, and fades. Their positions follow the generated section, so they stay in place when you regenerate. Changing them never needs a new render.

Both kinds play with the preview transport, are saved with templates, project files, and undo history, and appear in the Library's usage list. Projects containing audio tracks use archive version 7.

**Masks follow the input:** the video and audio mask editors take keyframes anywhere on the clock, including the generated section, which keeps whatever input it holds by default. A span with nothing to keep always regenerates at 100%, whatever the curve says there. The editor hatches those spans and draws your curve as a dashed line beneath the mask H3 actually receives; the timeline's mask lanes show the received mask. For video, the input is the reference footage (including stills and a loop's held end frame) and any added timeline videos; an image keyframe set to keep its frame keeps exactly that frame. For audio, it is wherever the input movie is audible: reference footage that has an audio track and isn't muted, added videos with audio, and unmuted input sounds. A loop's held end frame, still images, footage without an audio track, and muted sources have no sound to keep, so their audio regenerates. Seams between a reference and the generated section still always regenerate.

**Audio mix:** the generation timeline's side panel lists every audio source of the current tab with its own mute button and volume slider. On **Input** that is the Start (or Loop) and End reference footage, each added video, and each input track; these levels shape the audio H3 receives and count as input edits. On **Generated** it is the generated video, whose level is the story clip's volume (the same setting as **Clip audio** in the Inspector), and each generated track. Selected videos, tracks, and sounds also have volume controls in their own panels; a sound's level is multiplied by its track's. Levels can be changed while the preview plays, waveforms scale with them, and a slider drag is one undo step.

**Image references:** Drag Library images into **Image references**, or use **Add images** in a video’s generation settings to attach up to nine PNG, JPEG or WebP images (20 MB each before preparation). Refer to them in order as `<Picture 1>`, `<Picture 2>`, etc., and describe which subject or style each should guide. Removing an image renumbers those after it; update any affected prompt tags. Images supplement connected video context through H3’s native `MiniMaxH3ReferenceToVideo` node. To generate from images in an empty project, turn off **Start** and **End** references; the first image supplies the output aspect ratio. Images are prepared locally as JPEGs up to 1536 pixels on the longest edge and 1 MB, preserving aspect ratio and flattening transparency onto white. Attached images, their order, templates, and submitted settings persist in project archives. Standalone MP4 downloads record image provenance but do not embed the image files.

**Enhance prompt** inspects labeled previews of every attached image alongside any connected video boundary frames. It preserves `<Picture N>` tags and their requested roles while keeping video continuity instructions separate. Changing an attachment cancels any pending enhancement, so an outdated response cannot overwrite the prompt. Generation uses the visible prompt exactly as entered.

Video enhancement and shared continuity briefs keep established or requested music continuous between shots and across clip boundaries. Camera cuts should retain the same track, rhythm and level unless the prompt explicitly requests a music change or silence; no soundtrack is invented when none is established or requested.

**Enhance instructions:** the Project inspector (shown when nothing is selected) holds up to 4,000 characters of project-wide guidance, such as a visual style, setting, or dialogue language. **Enhance prompt** and **Edit with AI** send it with every video prompt, image prompt and continuity brief in the project. The model applies the parts relevant to that prompt. A prompt's own draft, edit request and settings take precedence where they conflict, and the instructions never override timed guides or the configured duration. Edits are undoable and persist in browser storage and project archives. Changing the instructions does not mark existing enhanced prompts as outdated; enhance a prompt again to apply them, and a request still in progress when they change is discarded.

**Enhance prompt** and **Edit with AI** resolve conflicting draft timing in one rewrite. Start-reference footage offsets the generated section; end-reference footage reserves the ending window. Both use the actual encoded duration, including padding, and convert generated-relative image guides to the full-video clock exactly once. Current guide times and reference windows stay fixed while conflicting prose is repaired. Requested final holds continue through the generated section's actual end. Reference speech is omitted from new dialogue only when the reference audio observations or the user's text establish that it was already spoken; an image or a short time budget alone is not evidence. The result is a corrected prompt, not a clarification request.

The rewrite receives an explicit `timing.offsetSeconds` derived from the encoded start reference. Unlabelled dialogue/action timestamps in the original draft default to generated-section time; an explicit clock declaration takes precedence. Enhancement adds the offset once to those cues and writes them as single full-video H3 timecodes such as `At 00:09.575`, while preserving compatible starts, ends and pauses. It adds no clock label: H3 reads every word of the prompt as part of the video, and the enhanced field already defaults to full-video time. Already full-video cues stay unchanged. **Edit with AI** keeps the original draft's clock and uses full-video time in its enhanced version; unlabelled edit instructions follow the draft's clock. End references limit the available generated interval without adding another offset. These instructions guide the model; they do not enforce sample-accurate speech timing in a rendered video.

Both rewrites follow the original prompt's event order, preserving before/during/after relationships and intentional overlap. They make that sequence explicit without imposing a default order for actions and dialogue. Explicit user corrections take precedence.

Enhanced prompts follow [MiniMax's H3 prompt guide](https://huggingface.co/MiniMaxAI/MiniMax-H3/blob/main/docs/VIDEO_PROMPT_WRITING_GUIDE_base_en.md). Each voice has a stable speaker ID such as `(S1)`. Each spoken line has its own `<d>` block in the same sentence as the visible action it accompanies, followed by a brief closing beat, such as the speaker closing their lips, before the next action. With start-reference footage, `[Shot 1]` briefly describes that footage, and new content that changes subject, space or viewpoint begins with a timecoded cut such as `[Shot 2] At 00:01.625, the camera cuts to …`; end-reference footage is handled the same way. Timestamps are single points, never ranges. Timed guide poses are described at their timecodes without mentioning the guides, which H3's text encoder never sees. The prompt describes only what is seen and heard, without notes to the model, and states what should appear rather than prohibitions, because H3 samples without a negative prompt. **Edit with AI** applies these conventions to text it adds or changes in the enhanced version and leaves the original prompt in its own format. Within one shot, H3 orders events by their written sequence; it does not lock a line to an exact instant, so timed guides remain the firm anchors.

**Loop ref:** Enabling **Loop** replaces the separate Start/End controls with one shared reference. Choose **Connected video** to use the incoming clip’s tail and hold its final frame as the ending reference, or **Picture 1** to anchor both the first and last generated frames to the first attached image. Outgoing destinations never choose a loop’s ending. Image-only loops require Comfy’s native `MiniMaxH3AddGuide` node, checked before submission. The **?** beside Loop ref explains the setup and its caveat: enabling playback looping on an existing video does not repair its seam. Regenerate with the shared reference, then preview the repeat to check motion, lighting and sound continuity. Imported source clips keep their original frames.

Older pin-based and call-response projects migrate to individual clips and arrows on opening, retaining their generated media and branch connections. Each legacy interaction section opens inside an editable group frame. New archives use version 3; versions 1 and 2 remain readable. Templates, groups, positions, routing, reference selection, and connection crossfade durations are saved.

By default, source videos that the browser and Mediabunny can decode retain their native format and frame rate, including the 25 fps example episode. **Options → Preferences → Video imports → Convert imported videos to 24 fps** prepares new video imports as constant 24 fps working copies. It applies to the video chooser, sample video, timeline imports, and Library imports. Conversion preserves resolution, playback speed, and audio timing, and retains the original file in the project. Compatible 24 fps MP4s are reused. The preference is off by default, is saved on this device, and does not change existing clips or convert media when reopening a project. Converted copies remain active after reopening even if the preference is later turned off. Imports take longer and frame dropping or duplication may introduce motion judder. Unsupported sources still use the compatibility preparation path when the preference is off. Video inspectors show the selected file’s measured average FPS, including imported and generated clips; this can differ from the edit clock. **Convert…** beside the frame rate creates a separate Library copy at a chosen rate from 1–240 fps, including fractional rates. The copy keeps its chosen FPS when added to the timeline, regardless of the import preference. Existing clips and the original file stay unchanged; conversion can be cancelled and adding the copy can be undone. `TIMELINE_FPS` remains the 24 fps edit clock for clip boundaries, stepping, and references. Graph playback uses the shared Mediabunny canvas and audio renderer, preloading upcoming clips and blending video and audio at joins. Source captions retain source timestamps and stay off generated footage. Description and voice APIs remain available internally; their panels are currently not shown in this editor.

## Local projects and portable project files

Videos opened from the project chooser, completed interstitial videos, and WebVTT subtitles are stored as Blobs in **IndexedDB**. Browser-playable source media is retained unchanged unless 24 fps import conversion is enabled. Converted and unsupported sources use a working copy while retaining the original. Cancellation or storage failure leaves the previous project intact. Project metadata autosaves to a browser working copy; **Save project** writes the complete project to a portable file. Remote generated clips are downloaded once and subsequently read locally.

Saves compare project contents: unchanged edits and live generation progress do not rewrite the browser working copy. Saving an unchanged project to its current file skips archive creation and disk writes, including after undoing back to the saved state. **Save as new file** and **Export project** still create a copy. Edits made while a file is being written remain unsaved until the next save.

**File → Export project** downloads a self-contained `.sparko` file. It is a ZIP archive containing a versioned `project.json` manifest and all referenced media bytes: the prepared source, its retained original, generated videos, and subtitles. It also includes the clip graph, templates, per-clip fades, reference ranges, prompts, generation states and job IDs, plus the description tool's range, provider, focus and latest caption/description. Generated videos retain their reference footage and exact inserted-section bounds. API keys, workspace passwords and temporary microphone recordings are not project content and are never included.

**Open project file** on the project chooser (or dropping a `.sparko` file onto the app) validates the archive, checks media boundaries, and opens it as a local working project. A native file picker keeps the file handle for subsequent saves and Recent; drag and drop or the fallback input require **Save as new file** to establish a file handle. Asset IDs are remapped so importing the same archive twice cannot mix their media. The project retains a mapping from earlier asset IDs so reference videos recorded in standalone MP4s can still be found after save/reopen. ZIP checksums detect damaged files; missing assets, unsupported versions and invalid metadata are rejected. Imported media is committed in one IndexedDB transaction. Opening and exporting show progress and support cancellation. Storage/quota errors leave the previous project available.

Exports are snapshots taken when export starts. Unfinished remote jobs retain their job IDs and can resume with the original provider account. Interrupted preparation returns to a draft. Project export copies stored originals without encoding. Opening a `.sparko` file checks every saved generated result, retained result, and branch asset against the native source. Older archives with both a legacy working copy and a playable original restore the original source and reconnect its timeline scenes; explicit frame-rate conversions retain their working copies. Mismatched generated media is converted before activation, with progress and cancellation. Compatible clips are reused. Conversion changes playback copies only; saved clip bounds, originals, and generation references retain their meaning.

The current archive limit is **8 GB of media** and **8 MB of metadata**. Media uses uncompressed ZIP entries to avoid spending time recompressing MP4s. Browser storage belongs to this browser profile and origin; clearing site data removes it, and browsers may evict it under storage pressure. Export project files for portable backups. Saved assets can play without the original local file or provider URL, once the app itself is loaded; this is not an offline installation of the app. Panel layout and transient playback controls remain workspace preferences.

## Interstitial generation and playback

`start_range` is the tail of the chosen reference clip; bridge generation also uses `end_range` from the destination clip. Ranges align to the project's 24 fps frame grid. The inspector shows the effective reference range and explains unavailable or stale dependencies. H3 bridge generation requires at least 1.625 seconds of usable context on each side.

Generated duration is saved per draft, including in exported projects. Its default and limits (6 seconds, 5–13 allowed) and reference limits are configured in `shared/constants.ts`. Older projects without a duration use the six-second default. Mediabunny exports an H.264/AAC reference MP4 capped at **1344 pixels on its longest edge** and 50 MB. These are Sparko limits, not a universal Comfy Cloud upload specification. `POST /api/comfy/interstitials` validates the requested duration, file and frame-aligned insertion coordinates before submitting the workflow. The generated section becomes the interstitial clip's playable body. Failed interstitials stay editable with the error visible; **Retry** uses the updated settings without a separate reset step.

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

The video inspector's LoRA section includes a **Turbo** toggle, off by default. **Options → Preferences → Video generation → Enable Turbo by default** sets the initial value for new clips and built-in templates on this device. Existing clips and saved custom templates retain their settings, and each clip can override Turbo in its inspector. It stacks `minimax_h3_ref2v_turbo_4step_v0.1_comfyui_bf16.safetensors` at strength 1 with the optional character/style LoRA, keeping its selected strength. Turbo uses the [LightX2V Ref2VA recipe](https://github.com/ModelTC/Minimax-H3-Turbo/blob/main/COMFYUI_SETUP_AND_INFERENCE.md): 4 steps, Euler/simple, and video/audio shifts 12/3. Turning it off restores the normal 20-step `res_multistep` workflow. The setting is saved per video, in submitted settings, templates, project archives and clip metadata; changes during a render apply to the next generation. The adapter is checked before reference preparation and again before upload/submission. Turbo can change output quality; visual quality and continuity still need evaluation with real renders.

Set `COMFY_CLOUD_API_KEY` in `.env`, then restart `npm run dev`. `COMFY_API_KEY` is also accepted. `COMFY_BASE_URL` defaults to `https://cloud.comfy.org`; it can point to a compatible HTTPS Comfy API deployment. Set the same server-only variables in Vercel and redeploy there. Run `npm run comfy:check` to verify authentication, required nodes, and H3 model availability without submitting a generation. Model filenames and sampling settings live in `shared/constants.ts`.

For Upscale to 2K, run `npm run comfy:check -- --2k`. The Comfy deployment needs the official [`MinimaxHailuo03RegenerateNode`](https://github.com/Comfy-Org/ComfyUI/blob/master/comfy_api_nodes/nodes_minimax.py) partner node, `VHS_LoadVideoFFmpeg`, `CreateVideo`, and `SaveVideo` (plus `GetVideoComponents`, `GetImageSize`, `ImageFromBatch`, `ImageScale` and `ImageBatch` when exact-frame keyframes are restored), with partner API access through the Comfy account. This uses MiniMax's [`/v2/video_regeneration`](https://platform.minimax.io/docs/api-reference/video-generation-v2-regeneration) endpoint with model `MiniMax-H3` and resolution `2K`. No community upscaler checkpoint is used. The upload goes to `POST /api/comfy/upscales`, which counts the render's frames on the server, uploads it as a Comfy asset and submits its own Comfy job; progress, cancellation, output retrieval and recovery use the same job routes as native generation. The server passes the partner credential through Comfy's typed per-job `extra_data.api_key_comfy_org` field; it stays outside the saved workflow and project. `GET /api/comfy/upscales/status` checks 2K support before the render is uploaded, and the server checks again before submission; missing 2K support is reported without submitting a paid job. The server still accepts the retired single-job `resolution=2k` parameter from older clients.

This implementation uses the [Comfy API v2](https://docs.comfy.org/api-reference/v2/overview) and native H3 video/audio latents with [MaskVidExperiments](https://github.com/drozbay/MaskVidExperiments). The specific `MiniMaxH3ContexMaskedAVBridge` custom node from the linked community workflow was absent from the managed Cloud catalog during setup. Instead, this graph independently encodes both context clips, places them at opposite ends of an H3 latent, and masks the missing middle using available Cloud nodes. When source audio exists it is conditioned and masked too; otherwise H3 generates audio. Image quality and boundary continuity need evaluation with actual generations.

H3 requires frame counts of `5 + 17k` at 24 fps. Context ranges round down to usable model windows, and total duration rounds up to the next valid frame count. A six-second draft with two-second reference ranges therefore uses 39 frames (1.625 seconds) per side and generates 148 frames (6.167 seconds). The panel shows these effective values before generation. At least 1.625 seconds of source footage must exist on both sides. Sparko caps sampling at 362 frames, a 1344-pixel longest edge, and a 768-pixel shortest edge, then rounds dimensions to multiples of 32. Comfy's [H3 native guide](https://docs.comfy.org/tutorials/video/minimax/minimax-h3-native) describes a 768-pixel **short edge** for the native canvas; that is a model canvas recommendation, not a Cloud input upload cap. Upscale to 2K requires a render of 107–362 frames, including references (about 4.46–15.08 seconds); for shorter renders, the inspector explains the requirement and the button stays disabled. Only the generated middle is inserted into Sparko's timeline; original footage remains the source outside it.

Connection crossfades have independent video and audio durations. Loop-enabled clips also have separate **Video fade** and **Audio fade** controls under **Loop** in the inspector, defaulting to 0.25 seconds. Either can be set to zero for a cut. Repeat fades blend the end with the beginning of the same playable range and are capped at half its length. Both channels stay synchronized: the next visit continues past the opening already covered by the longer overlap, shortening each repeat by that overlap. Loop fades are saved with the project and templates. The Options menu retains a master preview toggle. The legacy linear composition export API retains its original transition model; rendering a chosen graph path to MP4 is not exposed in the editor.

Comfy jobs stream live workflow stages and sampler steps: loading H3, encoding references, generating video/audio (for example, step 8/20), decoding, and encoding the MP4. On Comfy Cloud, the server listens to the [Cloud WebSocket](https://docs.comfy.org/development/cloud/api-reference#websocket-for-real-time-progress), filters its account-wide events by job ID, and forwards normalized progress through Sparko's authenticated SSE route. The interstitial panel and timeline show the percentage of the current stage when step counts are available. Coarse v2 polling snapshots cannot overwrite these node updates. If the optional legacy socket fails, stale steps are cleared and progress falls back to v2 SSE; custom v2 deployments use SSE directly. Streams reconnect, and v2 status polling remains authoritative for completion, cancellation, errors and output retrieval. Closing a stream does not cancel the job. Completed outputs are streamed through an authenticated application endpoint and saved into IndexedDB. The server resolves a fresh signed storage URL for each download/retry, so an expired URL does not require paying for another generation. Keys stay on the server. Provider submissions are never automatically retried after ambiguous network failures. Progress streams during generation; the playable video becomes available after the job completes.

New native MP4s include Comfy generation metadata through [VideoHelperSuite's `VHS_VideoCombine`](https://github.com/Kosinkadink/ComfyUI-VideoHelperSuite) with `save_metadata: true`. The embedded API prompt graph records the exact text prompt, random seed, model filenames, sampler, steps, dimensions, frame counts, and masking nodes/settings. The Upscale to 2K job uses Comfy's built-in [`SaveVideo`](https://github.com/Comfy-Org/ComfyUI/blob/master/comfy_extras/nodes_video.py), which embeds this graph by default unless the deployment disables metadata. No extra node installation is needed. **Download full video** preserves the original MP4 and its metadata; existing videos are not updated retroactively. API keys stay outside the graph. This is the executable API graph, not a Comfy editor layout or a bundle of the referenced input media. Inspect the file's tags with `ffprobe -v error -show_entries format_tags -of json video.mp4`.

The video inspector's **Seed** control defaults to **Random**, choosing a fresh seed in Sparko before each submission. Choose **Fixed** to enter a nonnegative integer (0–9007199254740991), or **Use last seed** to reuse the displayed render's seed. Seed settings persist in projects and templates; edits during generation apply to the next render. **Generated video** shows the actual seed used, which also travels with MP4 metadata. Upscale to 2K has no seed control; older renders made with the retired single-job 2K setting show their **H3 base seed**. Older Sparko MP4s recover their seed from the saved sampler graph when available.

Sparko also embeds a versioned `sparko` tag when saving a newly generated MP4 locally. It records the clip name, generation settings and exact submitted prompt, the start/end reference clip names and identities with frame ranges, generated-section boundaries, loop/conditional settings, render identity, job ID, actual sampling seed, and submission time. These are snapshots for that render; editing the next prompt or reconnecting the graph does not rewrite the saved video's history. Metadata is added by copying encoded video/audio packets without re-encoding, retaining Comfy's existing tags. Both the full output and an extracted loop carry metadata with their own playable boundaries.

Drop a video containing valid Sparko metadata onto the timeline or library, or open it from the project chooser, to restore an editable, completed interstitial automatically. Adding that saved asset from the library works too. Each import gets independent clip IDs and supports undo/redo and project save/reopen. Imported scenes remain disconnected, even when their saved reference clips are available. Matching reference identities and frame ranges are retained for playback information; connect scenes manually to choose their place in the graph. **Generated video** shows the saved start/end video names, with **Select** buttons to highlight and reveal those clips when they are in the timeline. Missing original videos remain named in **Video breakdown** and can be connected manually before regeneration. Metadata records their identity, not their media bytes. Plain videos, older files containing only Comfy metadata, unsupported metadata versions, and files whose saved boundaries no longer match their duration import as ordinary source clips. Import never resumes the embedded job or starts a new generation. Sparko metadata is validated and limited to 256 KB.

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

The sample project is [`examples/sample.sparko`](examples/sample.sparko), named `sample`, with `sample.mp4`, 13 timeline clips, nine completed generations, two drafts, and two saved interaction groups. It is tracked with Git LFS; run `git lfs pull` before uploading from a fresh checkout. The archive is approximately 155 MiB.

The app starts with a project chooser showing recent projects, sample projects, and an action to create a project from a video. **Sample video** loads `examples/sample.mp4` as a clean project; **Sample project** opens `examples/sample.sparko` with its saved interstitials. Each loads only when selected. **File → Close project** closes the active editor and returns to the chooser; changed projects ask whether to save, discard, or cancel. **File → Save project** creates a `.sparko` file on disk; later saves update that same file. **Save as new file** chooses another path. **Recent projects** stores references to opened or saved files so they can be reopened, removed from Recent, or deleted from disk where the browser supports file deletion. The `.sparko` file contains the project and its media, so it can also be moved to another computer. In browsers without the native file picker, Save downloads the archive and **Open project file** uses a normal file input; those browsers cannot update the same file or list it in Recent. Older browser-only projects remain available on the chooser for migration. On Vercel, run `npm run vercel:upload-default` for the sample video and `npm run vercel:upload-sample` for the sample project, then set `DEFAULT_VIDEO_URL` and `DEFAULT_PROJECT_URL` to the respective Blob URLs.

1. Run `npx vercel login` and `npx vercel link` to select your account/project.
2. Create a **public Blob store** in the project's Storage tab and connect it to Preview and Production. This creates `BLOB_READ_WRITE_TOKEN`.
3. Make that token available locally without overwriting your `.env` (for example, add it to `.env`), then run `npm run vercel:upload-sample`. Set the printed URL as `DEFAULT_PROJECT_URL` in Vercel. The script validates the complete archive before uploading and uses a new URL for each snapshot. To replace the sample project later, export the desired project from the app and run `npm run vercel:upload-sample -- path/to/project.sparko`. Run `npm run vercel:upload-default` and set `DEFAULT_VIDEO_URL` to enable **Sample video**.
4. Set these server-side environment variables in Preview and Production:
   - `OPENAI_API_KEY`
   - `GEMINI_KEY`
   - `COMFY_CLOUD_API_KEY`
   - `FAL_KEY` (image generation)
   - `ELEVENLABS_API_KEY` (dialogue, music, sound effects and character voices)
   - `BLOB_READ_WRITE_TOKEN` (provided by the store)
   - `DEFAULT_PROJECT_URL` (or `DEFAULT_VIDEO_URL` for a video-only sample)
   - `APP_PASSWORD` (optional: leave unset or empty for access without a password; set a separate workspace password to require unlocking AI tools)
5. Push changes to GitHub. Vercel builds previews for branches and production for `main`; a separate production push is not needed. Use `npm run deploy:preview` for a manual preview.

Vercel scopes variables separately: Production values do not automatically reach Preview or Development. Configure provider keys in each needed environment, including Development for Vercel local development. Store credentials as Secrets. Redeploy existing previews after changing their variables; `/api/status` reports whether each provider is configured without exposing its key. Local `.env` credentials are still needed when an unreadable Secret cannot be downloaded by `vercel env pull`.

The deployed app enables configured AI providers and uploads without a password by default. Setting `APP_PASSWORD` enables the workspace password gate for upload tokens and provider requests, both locally and on Vercel. To turn the gate off, remove or empty `APP_PASSWORD` and restart/redeploy. The sample project archive is served by its public Blob URL. Temporary analysis uploads use random URLs in `transient/` and are deleted after retrieval or request cleanup. An interrupted browser can leave an upload behind; remove old `transient/` objects in Blob as needed. Only the configured Blob store is accepted for remote API inputs. Local runs do not need Blob or a password; the local chooser serves `examples/sample.sparko` automatically.

Do not prefix API secrets with `VITE_`. Redeploy after changing deployment environment variables. This is a single-workspace app; interstitials and panel sizes remain browser-local, and all app users share the configured API credits.

## Verification

[The CI workflow](.github/workflows/ci.yml) runs the full TypeScript check, unit/API tests, production build, and Chrome browser tests on pull requests, pushes to `main` or `ci/**` branches, and manual runs. Browser tests are divided across sixteen independent runners, with one browser worker per runner; extra workers on one runner contend for its CPUs and make timing-sensitive tests flaky. [`scripts/browser-shard.ts`](scripts/browser-shard.ts) assigns whole spec files to runners using the CI durations recorded in [`tests/browser/durations.json`](tests/browser/durations.json), so the runners finish together. New spec files use the median duration until the file is refreshed: download the `browser-test-results-*` artifacts from a passing run and pass their `test-results/results.json` files to `npx tsx scripts/browser-shard.ts --update`. Updates to an open pull request rerun CI without a duplicate branch-push run unless its branch starts with `ci/`. The required **Sparko quality checks** job succeeds only when verification and every browser shard passes. Pull requests are optional: direct pushes to `main` are allowed once that exact commit has passed the required check. To validate a commit before a direct push, use `git push origin HEAD:ci/validate-main`, wait for its push-triggered CI run to pass, then push the same commit to `main`. Manual workflow runs do not satisfy GitHub's required-check gate.

CI uses `npm run test:e2e:ci`, which excludes tests tagged `@slow` or `@generation`. The normal local `npm run test:e2e` command uses the same fast selection. Tagged generation scenarios are excluded even though their provider responses are mocked. All excluded tests remain available through `npm run test:e2e:full` or `npm run test:full`. The fast browser suite continues to cover editing, playback, preview, menus, loading states, and project operations.

Tests tagged `@flaky` still run in CI but are optional: each has failed in CI on code that passed in another attempt or another run. If one still fails after its retry, the run shows a warning and the shard passes; any other failure still fails it. [`scripts/browser-results.ts`](scripts/browser-results.ts) makes that decision from Playwright's JSON report. Local runs treat them like any other test. List them with `npx playwright test --list --grep @flaky`, and remove a test's tag once its cause is fixed. The current tags come from CI runs between November 6 and 10, 2026, leaving out an experiment that ran several workers per runner.

For faster PR feedback, the ten longest individual cases from the [November 5 CI run](https://github.com/david-lu/sparko/actions/runs/42070133184) are also tagged `@slow`. The new tags apply only to the listed variants, alongside the existing exclusions:

| Additional full-suite-only case | Measured CI time |
| --- | ---: |
| Generation reference uploads preserve cropping | 67.99s |
| Custom masks submit independently during generation, 1440px | 29.92s |
| Create from scratch with looping and conditions, 1440px | 28.42s |
| Image references guide loop enhancement and generation, 1440px | 28.28s |
| Create from scratch with looping and no conditions, 1440px | 23.67s |
| Template grouping, moving, renaming, duplication and archives | 21.81s |
| Fullscreen controls follow mouse activity | 19.50s |
| Bundled sample opens its timeline and interaction groups | 16.73s |
| Custom masks submit independently during generation, 390px | 16.38s |
| Large-source preparation preserves size, aspect ratio and frame rate | 16.05s |

The earlier slow exclusions were selected from [PR #4's CI timings](https://github.com/david-lu/sparko/actions/runs/41590453223), including the preceding successful runs of those cases. Approximate time per test, including browser setup and teardown:

| Excluded slow scenario | Cases | Time per case |
| --- | ---: | ---: |
| Comfy generation, recovery, and regeneration | 4 | 32–51 seconds |
| Inspector generation with all reference combinations | 1 | 37–38 seconds |
| Complete project archive round trip with generated media | 1 | 24 seconds |
| Sample group sizing at desktop and mobile widths | 2 | 21–24 seconds |
| Connected generation with save/reopen | 1 | 23 seconds |
| Upscale to 2K, Upscaled tab and persistence | 2 | 8–12 seconds |
| Full-resolution reference and Idle video processing | 1 | 21 seconds |

Vercel's production check must match that job name and block production domain assignment until it succeeds. This lets builds run while CI is testing; failed or missing checks leave the previous production deployment serving traffic. Manual CLI deployments still need a matching successful GitHub check. The production build uses `tsconfig.build.json`, while `npm run typecheck` includes tests and development scripts. Tests and scripts are excluded from Vercel uploads, not from CI.

For a fresh checkout, install dependencies with `npm ci`, fetch fixtures with `git lfs pull`, and install Chrome with `npx playwright install --with-deps chrome`. Then run:

```sh
npm run typecheck
npm test
npm run build
npm run test:e2e
```

To run the complete verification sequence, including every slow and mocked-generation browser case:

```sh
npm run test:full
```

This runs typechecking, unit/API tests, the production build, and the unfiltered browser suite in order, stopping if a step fails. To run only the complete browser suite, use `npm run test:e2e:full`. You can inspect its selection without launching a browser with `npm run test:e2e:full -- --list`.

CI never submits live model-generation jobs. The browser test server clears provider credentials and sets `SPARKO_TEST_MODE=1`, which blocks outbound Comfy requests even if a credential is accidentally supplied. Comfy unit tests use injected mock transports and fake credentials. Real video encoding/decoding, playback, audio, and project-file operations remain covered. Live-provider tests belong in `tests/live/`, which is excluded from the default unit and browser suites. The optional `npm run comfy:check` command calls the live readiness API without submitting a generation and is not run by CI.

Browser tests use installed Google Chrome. The new `story-flow.spec.ts` suite covers proportional clip widths, scrubbing, splitting, insertion, independent fades, templates, arrow dragging and reconnection, undo/redo, branching playback, stable narrow-screen loading, generated media save/reopen, and legacy sample migration. Former pin and fixed Call/Idle/Response UI tests now exercise graph clips, templates, independent durations, and condition sockets. Graph suites cover dragging, cancellation, history, resizing, routing, and legacy sample migration; retained legacy controllers and archive formats remain covered by unit and media tests. The existing media suites cover playback, persistence, subtitle toggling, viewport fit, resizing, real non-keyframe MP4 export with audio, real reference preparation, interstitial job recovery/cancellation, native playback across cuts, generated-media conversion on archive import, cache reuse, and composed-export frame counts and audio. Voice tests mount the retained component in an isolated harness and use synthetic audio, never your microphone. Browser tests own a server on port 3100 and clear provider credentials, passwords, and remote sample URLs so local `.env` settings cannot change their behavior. Unit tests cover frame mapping, reference bounds, legacy migration, job lifecycle, voice capture, provider adapters, and API validation. Provider responses and Comfy generation are mocked to avoid recurring paid jobs; media processing runs for real. `tests/fixtures/voice-answer.wav` is a locally generated Windows speech-synthesis fixture; `interstitial-reference.mp4` is a synthetic four-second validation fixture.

Project tests cover binary archive round trips, invalid/corrupt archives, fresh-browser import with remote assets blocked, reopening a disk project through Recent, subtitle/description persistence, and storage failures. IndexedDB stores working media, metadata and recent file handles; [zip.js](https://gildas-lormeau.github.io/zip.js/) packages and validates the project archive.

Media checks cover native playback of 25 fps sources without encoding, 24 fps reference conversion, variable frame spacing in the fallback converter, cancellation without partial assets, and reopening saved projects. Browser tests use a short source for most project flows; the local server can serve the real default episode directly.

Libraries: React, TypeScript, Vite, Mediabunny, `@mediabunny/aac-encoder`, `@zip.js/zip.js`, `@ricky0123/vad-web` (with ONNX Runtime Web), Express, Multer, Zod, dotenv, OpenAI SDK, Google GenAI SDK, Vercel Blob, and Lucide. `vite-plugin-static-copy` bundles the speech detection assets. Tests use Vitest, Supertest, and Playwright.
