# Testing and CI

[The CI workflow](../.github/workflows/ci.yml) runs the full TypeScript check, unit/API tests, production build, and Chrome browser tests on pull requests, pushes to `main` or `ci/**` branches, and manual runs. Browser tests are divided across sixteen independent runners, with one browser worker per runner; extra workers on one runner contend for its CPUs and make timing-sensitive tests flaky. [`scripts/browser-shard.ts`](../scripts/browser-shard.ts) assigns whole spec files to runners using the CI durations recorded in [`tests/browser/durations.json`](../tests/browser/durations.json), so the runners finish together. New spec files use the median duration until the file is refreshed: download the `browser-test-results-*` artifacts from a passing run and pass their `test-results/results.json` files to `npx tsx scripts/browser-shard.ts --update`. Updates to an open pull request rerun CI without a duplicate branch-push run unless its branch starts with `ci/`. The required **Sparko quality checks** job succeeds only when verification and every browser shard passes. Pull requests are optional: direct pushes to `main` are allowed once that exact commit has passed the required check. To validate a commit before a direct push, use `git push origin HEAD:ci/validate-main`, wait for its push-triggered CI run to pass, then push the same commit to `main`. Manual workflow runs do not satisfy GitHub's required-check gate.

CI uses `npm run test:e2e:ci`, which excludes tests tagged `@slow` or `@generation`. The normal local `npm run test:e2e` command uses the same fast selection. Tagged generation scenarios are excluded even though their provider responses are mocked. All excluded tests remain available through `npm run test:e2e:full` or `npm run test:full`. The fast browser suite continues to cover editing, playback, preview, menus, loading states, and project operations.

Tests tagged `@flaky` still run in CI but are optional: each has failed in CI on code that passed in another attempt or another run. If one still fails after its retry, the run shows a warning and the shard passes; any other failure still fails it. [`scripts/browser-results.ts`](../scripts/browser-results.ts) makes that decision from Playwright's JSON report. Local runs treat them like any other test. List them with `npx playwright test --list --grep @flaky`, and remove a test's tag once its cause is fixed. The current tags come from CI runs between November 6 and 10, 2026, leaving out an experiment that ran several workers per runner.

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
