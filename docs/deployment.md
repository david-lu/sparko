# Deploying to Vercel

`vercel.json` builds the Vite frontend and routes API/media requests to `api/index.ts`, a Node.js function with a 300-second timeout. Account credentials and local Vercel project links are not committed.

Server-side relative imports use explicit `.js` extensions so Vercel's compiled Node.js ES modules resolve correctly; `tsx` and Vite resolve these to the TypeScript sources during development.

Large videos go directly from the browser to **Vercel Blob**. They do not pass through the function request body, which has a [4.5 MB limit](https://vercel.com/docs/vercel-blob/client-upload). The sample video and project archive are excluded from the deployment bundle and served from Blob instead.

The sample project is [`examples/sample.sparko`](../examples/sample.sparko), named `sample`, with `sample.mp4`, 13 timeline clips, nine completed generations, two drafts, and two saved interaction groups. It is tracked with Git LFS; run `git lfs pull` before uploading from a fresh checkout. The archive is approximately 155 MiB.

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
