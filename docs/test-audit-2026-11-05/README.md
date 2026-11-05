# Test audit — 5 November 2026

The unit/API suite provides substantial protection at negligible runtime cost. The browser suite exercises real media processing and important user workflows, but the required CI check excludes valuable mocked-generation tests and currently passes while the full suite fails. The clearest measured opportunity to shorten CI is balancing its browser shards.

Snapshot at audit start; later concurrent appearance work and its new tests are outside this report. Audited commit: `3d2453285e0047e550bbd2e4aa028c4036b47ae9` on `feat/still-images-and-multi-clip-references`. This audit changes documentation only. It does not change application code, tests, CI policy, or deployments.

## Measured inventory and runtime

| Suite / check | Cases | Observed elapsed time | Result |
| --- | ---: | ---: | --- |
| Unit/API, local | 841 | **1.80s** wall | 841 passed |
| Full browser suite, isolated local snapshot | 328 | **14m 10s** wall | 325 passed; 3 failed, including 1 timeout |
| Unit/API, current CI | 841 | **8.86s** runner; 9s step | 841 passed |
| Browser suite, current CI | 310 | **13m 42s** longest browser runner | 310 passed; 18 cases excluded |
| Entire current CI workflow | Unit + selected browser + typecheck/build | **14m 54s** | Passed |

At this snapshot there are **134 test files and 1,169 runner-expanded test cases**: 61 Vitest files with 841 cases, and 73 Playwright files with 328 cases. Parameterized variants count separately. Vitest's JSON `numTotalTestSuites` includes nested suites; it is not the file count.

The default commands do not execute the same browser coverage:

| Command | Browser cases selected | Omitted |
| --- | ---: | --- |
| `npx playwright test` | 328 | None |
| `npm run test:e2e` | 313 | All 15 `@generation` cases |
| `npm run test:e2e:ci` | 310 | 15 generation cases plus 3 additional slow-only cases |

Twelve cases have `@slow`; nine of those also have `@generation`. Thus CI excludes **18 distinct cases**, not 27. Neither the pull-request workflow nor manual workflow dispatch runs the excluded cases; there is no full-suite scheduled workflow. [Selection and workflow configuration](../../.github/workflows/ci.yml), [package scripts](../../package.json), [Playwright configuration](../../playwright.config.ts).

Local timings are observations from one full run on macOS 26.5.1 / ARM64, Node 26.0.0, installed Google Chrome, one browser worker, no retries. CI uses Ubuntu 24.04, Node 24, headed Chrome through Xvfb/software Vulkan, four independent shards, one worker each, and one retry. These are different environments, not an apples-to-apples machine benchmark. The authoritative local browser run used an unchanged temporary source copy, its own dependency cache, and test port 3201. All 383 source/test text files were verified against the audited Git tree; no application source in that copy changed during the run. Dependencies and large read-only sample assets were reused. Source isolation does not make this an isolated-machine performance benchmark. The normal project test configuration owns port 3100.

The full run includes one 90-second timeout, so this is not a healthy-suite baseline. The 18 excluded cases sum to 199.8s locally, including that timeout; do not treat that number as the inherent cost of restoring their coverage.

Local wall time includes runner/server startup and teardown. Per-case CSV durations are test durations; summing parallel Vitest case times does not produce wall time. CI totals include queue/setup/upload/final-gate time where labeled. Filtered local commands were inventoried, not separately rerun for timing. No paid generation or physical microphone was used.

## Required CI cost and reliability

The [current commit's CI run](https://github.com/david-lu/sparko/actions/runs/42070133184) passed all 310 selected browser cases without retries. It took **14m 54s** from workflow start to completion. The verification job took 46s, including 9s for unit/API tests, 2s for typechecking, and 2s for the production build. The browser jobs determined the overall wait.

| Browser shard | Cases | Browser runner time | Entire job |
| --- | ---: | ---: | ---: |
| 1 | 78 | 8m 12s | 9m 17s |
| 2 | 78 | 13m 42s | 14m 43s |
| 3 | 77 | 8m 15s | 9m 16s |
| 4 | 77 | 8m 59s | 10m 01s |

The four shards contain almost equal case counts but very different costs. The measured case-duration total is 2,314.148 seconds. Dividing that work evenly would be about 9m 39s per shard before startup/teardown, compared with shard 2's 13m 33s of case time. A greedy longest-first simulation assigns all 310 cases into bins of 578.847s, 578.195s, 578.900s and 578.206s (75/79/77/79 cases). The predicted case critical path falls by 233.859s: **3m 54s**. This is a scheduling simulation, not a validated CI speedup. The proposed assignments are recorded in [proposed-shards.csv](proposed-shards.csv). Rendering contention, test isolation, and fixture placement still need benchmarking. Simply increasing browser workers could introduce resource contention.

All six jobs together consumed **44.1 runner-minutes** in this run; this is elapsed runner time, not a billing estimate. Browser installation took 29–32s per shard, much less than the test phase. Optimizing npm installation or the unit suite is a lower priority.

The five successful runs immediately preceding this commit took **14m 05s–15m 33s**, median **14m 44s**. Shard 2's test step took 13m 01s–14m 25s in those runs, consistently the longest. This supports a persistent allocation problem rather than one unusually slow machine. See [the previous run](https://github.com/david-lu/sparko/actions/runs/42066673006) and [all sampled job durations](ci-jobs.csv).

Two of those five successful workflows contained a first-attempt test failure that passed on retry:

- [Run 42005913714](https://github.com/david-lu/sparko/actions/runs/42005913714): `project.spec.ts`, save/open/delete test, `TypeError: network error` while reading the saved archive.
- [Run 42010975896](https://github.com/david-lu/sparko/actions/runs/42010975896): `project-shortcuts.spec.ts`, unchanged save at 600px, shared `openVideo` fixture expected one clip but found zero.

The 30-run snapshot collected at audit start, updated with the audited run's completion, contains 23 successes, six cancellations, and one failure. Cancellations are not test failures. The failed [run 41881280818](https://github.com/david-lu/sparko/actions/runs/41881280818) blocked the quality gate when portable-video insertion produced one clip instead of two at both desktop and narrow widths, including on retry. That is evidence the gate can stop regressions; the logs alone do not establish whether its root cause was application behavior or a test expectation. The same older run had an import-fixture flake in prompt enhancement.

Retries currently allow an intermittent failure to finish green, with no `failOnFlakyTests` setting or checked-in retry trend report. Keep retries as diagnostic evidence, investigate the import/save races, and track first-attempt failures separately. This short, rapidly changing commit sample is not a long-term flake-rate estimate.

## Failures found in the full local suite

The complete immutable-snapshot run reproduced **three failures, all excluded from CI**. The shared-workspace run and focused repeat also showed the same failures.

| Case | Isolated result | Assessment |
| --- | --- | --- |
| `generation-resolution.spec.ts:12`, 1440px | Layout assertion failure | Turning off 2K during generation shifts the controls below the seed help upward **16.5px**. Actionable layout regression. |
| `generation-resolution.spec.ts:12`, 390px | 90s timeout waiting for `Video prompt` | Drag-based setup never exposes the expected draft editor; investigate setup/interaction before claiming mobile generation coverage. |
| `inspector.spec.ts:3` | Submit-button bottom at 673px versus expected maximum below 460px | Absolute compactness expectation no longer matches today's controls. Review intended layout and preserve meaningful geometry checks. |

The first full run in the shared workspace took 15m 40s and reported 324 passes/four failures. Its extra failure was `universal-library.spec.ts:110`, a timeout in a drag helper while requesting an asset's bounding box. File timestamps subsequently showed concurrent appearance edits overlapping that run. The case passed on a focused repeat, the complete immutable-snapshot run, and the audited CI run. **Do not classify that observation as an intrinsic application/test flake:** source changes and hot reload were a confounder. The initial browser timings are retained only as qualified observations; the inventory uses isolated timings.

See [isolated results alongside earlier observations](failures.csv). The temporary-copy run had an initial setup attempt with a missing audio fixture; it was stopped, the fixture restored, and all 328 cases rerun. That attempt is excluded from the reported timing. An initial shared focused launch similarly collided with server teardown and executed no cases.

The desktop layout shift is consistent with the seed-help text changing when 2K is toggled: [GenerationSeed.tsx](../../src/features/interstitials/GenerationSeed.tsx) conditionally adds a sentence, while [styles.css](../../src/features/interstitials/styles.css) reserves height for resolution help but not seed help. This is a source-based explanation, not a separate patch validation. The inspector test's absolute height threshold needs review against today's controls; increasing it without preserving meaningful geometry checks would weaken the test.

The mobile 2K case fails before submission: its drag-based setup never exposes the video prompt. It therefore provides no evidence about mobile 2K generation/persistence after that point. Repair the setup and assert that the draft exists before progressing. Both 2K tests also bundle generation, template persistence, and archive import, so an early failure prevents those later assertions from running.

The excluded suite also contains useful generation recovery, connected-reference save/reopen, full generated-project round-trip, sample-group geometry, and full-resolution loop processing. All 18 exclusions and their measured local durations are in [excluded-browser-tests.csv](excluded-browser-tests.csv). Do not assume the exclusions represent live-provider cost: the generation tests mock providers, and the test server clears credentials.

## What the tests detect well

| Area | Evidence and protected bugs | Limits |
| --- | --- | --- |
| Reference math, still images, highlights | Unit tests cover multi-clip windows, before/after order, partial crops, branch ambiguity, cycles, stale provenance, aliases, and a one-frame minimum. Browser tests check input validity/arrow stepping, image playback, decoded colors, silent image sections, saved state and selected highlights. | Fixtures exercise selected shapes, formats and timelines, not every image codec or arbitrary graph. |
| Generation lifecycle and paid-job protection | Controller and sequence tests cover late submissions/results, cancellation failures, project switches, duplicate submission prevention, recovery, independent edits and retaining an old render after a failed replacement. | Unit media/storage/provider dependencies are mocked; several complete browser recovery paths are excluded. |
| Project integrity | Real ZIP round trips, schema/version rejection, remapped asset identities, legacy migration, dirty-state/save races, undo/redo and referenced-asset deletion guards. Browser tests inject quota failure and cancellation into real IndexedDB transactions and check rollback. | The fullest fresh-browser generated-project round trip is excluded. File-picker UI and some boundaries are substituted. |
| Media correctness | Real encoding/decoding, crop pixels, frame counts, duration, waveform RMS, silent spans, resampling, independent audio/video fades, GPU and Canvas2D output, repeated loops, resource cleanup and cancellation. | Mostly short synthetic media; no sustained memory/throughput benchmark or broad codec/platform matrix. |
| API and provider contracts | Express/Supertest request validation, origin/header/password protection, bounded uploads, error sanitization, provider payloads, masks, seeds, resolution and capability preflight. | External services are mocked. Some capability fixtures derive from the same workflow builder under test; they cannot independently verify live upstream compatibility. |
| Loading, layout and interaction | Bounding-box checks at idle/loading/error/completion, delayed operations, narrow widths, hit-tested popup stacking, keyboard focus/shortcuts, overflow and a touch-enabled timeline test. | Some central generation geometry cases are excluded. Screenshots are usually evidence artifacts, not golden-image comparisons. |
| Voice | Synthetic stream drives real speech detection and WAV format checks; tests cover permission denial, explicit submission and stopped tracks. | Retained component mounted in a harness, not a physical microphone or live speech-model quality test. |

The browser suite breaks down as follows. Durations here are sums of case execution times, not wall time, and the local generation group includes the 90-second timeout.

| Browser area | All cases | In CI | Local summed case time | CI summed case time |
| --- | ---: | ---: | ---: | ---: |
| Projects and asset operations | 75 | 74 | 131.6s | 533.0s |
| Media rendering and playback | 53 | 52 | 131.1s | 312.7s |
| Timeline and graph editing | 71 | 68 | 133.8s | 521.6s |
| Generation and provider UI | 57 | 47 | 296.4s | 487.1s |
| Workspace, loading and interaction | 56 | 53 | 98.5s | 304.8s |
| Still images and reference windows | 14 | 14 | 39.9s | 141.1s |
| Voice capture | 2 | 2 | 9.8s | 13.9s |

The unit suite's functional distribution is: Comfy 255 cases, story-flow 182, interstitials 135, project 110, call-response 96, API/hosting/shortcuts 22, player 18, media 14, and voice 9. Small unit counts under `media/` and `player/` do **not** imply those systems lack tests: much of their meaningful coverage lives in browser media tests.

## Deliberate regression probes

Nine changes were made one at a time in an isolated temporary copy. The unchanged copy first passed all 841 unit tests. Each probe then ran the entire unit suite, and its source was restored afterward. The original application workspace was unchanged. Failures below are assertion failures, not dependency/setup failures.

| Deliberate regression | Unit cases that failed |
| --- | ---: |
| Image/end trims incorrectly require two frames | 2 |
| Start references consume earliest clips before nearest clips | 5 |
| Reference sequences silently collapse to one clip | 7 |
| Completed highlight uses current draft inputs before saved render inputs | 4 |
| Transient progress incorrectly changes saved document content | 2 |
| Deletion ignores references and allows used assets to be removed | 2 |
| Import reuses existing asset identities | 18 |
| Cross-origin requests reach protected routes | 5 |
| Responses lose the content-type sniffing protection header | 0 |

Eight probes were caught; removing `X-Content-Type-Options: nosniff` survived all 841 unit tests. That identifies a specific unasserted HTTP response contract. It is a small, concrete addition for the existing API tests, not a reason to expand a general security checklist. **8/9 is not an estimated percentage of real bugs caught**: these were deliberately selected probes, not random mutations or exhaustive mutation testing. Full changes and detecting case names are in [mutation-probes.csv](mutation-probes.csv).

## Expensive tests and opportunities

| Case | Current CI | Local | Why retain the coverage |
| --- | ---: | ---: | --- |
| `generation-framing.spec.ts` — generation uploads keep the same center crop when original and generated references are swapped | 67.99s | 2.70s | Actual uploaded crop, frame count and pixels |
| `mask-curves.spec.ts` — custom masks submit independently and keep controls stable through generation at 1440px | 29.92s | 5.25s | Independent masks and stable generation controls |
| `from-scratch.spec.ts` — create from scratch: loop true, conditional true, 1440px | 28.42s | 5.49s | Full prompt-only conditional-loop creation |
| `image-references.spec.ts` — H3 images guide loop enhancement and generation with stable loading at 1440px | 28.27s | 6.04s | Loop image conditioning and generation payload |
| `from-scratch.spec.ts` — create from scratch: loop true, conditional false, 1440px | 23.67s | 4.53s | Full loop creation without conditionals |
| `groups.spec.ts` — templates stay grouped, move their clips and bends together, and support rename, duplicate, ungroup and archives | 21.81s | 3.56s | Group move/rename/duplicate/archive behavior |
| `fullscreen.spec.ts` — fullscreen controls follow mouse activity and remain available during interaction | 19.50s | 15.48s | Idle hiding while mouse/keyboard controls remain usable |
| `story-flow.spec.ts` — the bundled sample project opens its saved timeline and interaction groups | 16.73s | 2.31s | Bundled project opens its saved graph and groups |

These slow tests generally have meaningful assertions. `generation-framing.spec.ts` really encodes several media variants and verifies uploaded crop geometry and output packets. It took 68.0s on the current CI run and 81.6s on the immediately preceding run, close to its 90s limit. The current CI report assigns 67.788s to its main browser evaluation and only 0.102s to setup, confirming that setup optimization alone will not fix this case. It is included in CI even while several cheaper mocked scenarios are excluded. The current tags no longer provide a consistent speed/value boundary.

Optimize repeated media preparation and split independent framing scenarios so they can be distributed; preserve actual output checks. Review `from-scratch`, `image-references`, and `mask-curves` for repeated setup that can share immutable fixtures without sharing mutable page state. Desktop/narrow variants are not automatically duplicates: layout and drag behavior differ, and layout stability is an explicit project requirement.

Only six `page.waitForTimeout` call sites were found: three 2.8s waits in fullscreen behavior, 0.8s and 2.2s in voice, and 0.85s in the parameterized startup layout test. Their purposes include real inactivity and speech detection, so blindly removing waits is inappropriate. Fullscreen's controlled UI timers are a candidate for clock-based testing; retain at least one real interaction path. This is a targeted opportunity, not the main explanation for a 15-minute gate.

## Coverage gaps and test-design risks

- **Still-image format edges have limited coverage.** The timeline still-image tests use opaque, generated PNGs. Dedicated timeline tests for JPEG/WebP import, EXIF orientation, transparency and the promised first frame of animated images were not found. The mixed-reference media test reads an encoded packet count but does not assert it; add an exact one-frame image-segment export assertion alongside the existing duration, pixel and silence checks.
- **Coverage is not measured or gated.** No coverage provider or script is declared in the package configuration, and no coverage thresholds or mutation configuration are present. Passing 1,169 cases is not a statement about covered lines, branches, or real-world defect probability. Start with branch coverage on reference selection, lifecycle transitions, archive validation and request boundaries; do not pick a global percentage without measuring it.
- **Production runtime is not exercised by browser CI.** The build is compiled, but Playwright starts the development server. The missing-deployment-chunks test is a useful simulation against that server, not a test of emitted assets on production hosting. Add a small built-output open/edit/save/reopen smoke test.
- **Browser/platform coverage is narrow.** Chrome only; most “mobile” tests change viewport size. One file enables touch. No Firefox/WebKit project or real-device run is configured. Test supported fallback behavior and target-device APIs separately; a narrower viewport does not validate Safari codecs, device permissions or GPU behavior.
- **Live compatibility remains external.** There is no `tests/live/` suite in the tree. `comfy:check` is a manual readiness script, outside CI. Provider mocks cannot catch upstream schema, availability, billing, inference-quality or workflow-execution changes. A separately authorized, explicitly scoped live check would address a different risk than the existing deterministic tests.
- **Unexpected browser errors are not globally enforced.** The shared fixture simply re-exports Playwright's test object; 36 of 73 spec files install a `pageerror` listener themselves. A shared fixture could fail unexpected uncaught errors consistently, with explicit handling for intentional failures. Do not fail every console warning indiscriminately.
- **Visual protection is selective.** Fifty-one browser spec files take screenshots and 51 read geometry; there are no `toHaveScreenshot`/snapshot assertions. Existing pixel/geometry/hit-test assertions are useful, but many typography/color/visual changes can still pass. Add only stable, valuable visual comparisons if that risk matters.
- **Long mixed scenarios can hide later gaps.** Generation/recovery/archive tests often contain many sequential assertions. Split independent behavioral contracts and retain a small number of complete workflows, so an early selector/layout failure does not prevent all persistence checks.
- **Operational limits remain mostly unmeasured.** Existing tests check decoder reuse/bounds and storage rollback, but no sustained playback soak, large-project latency budget, GPU device-loss recovery test or browser-crash/restart recovery suite was found. These are targeted follow-ups for operational reliability, not a reason to enlarge every PR run.

## Recommended order

1. Repair the three failing excluded cases, keeping the desktop loading-layout assertion meaningful. Separate setup failures and outdated design expectations from actual regressions.
2. Stop silently excluding all mocked generation coverage. Promote fast capability/layout cases and representative generation recovery plus archive round-trip coverage to the required gate. Run the full deterministic suite on a scheduled or dedicated workflow, with visible results; reserve any future live-provider tests for an explicit opt-in path.
3. Balance shards using measured duration and optimize the 68–82s framing test. Target the observed roughly four-minute allocation opportunity before deleting coverage or adding workers.
4. Diagnose the import/save flakes and expose first-attempt failures. Centralize unexpected `pageerror` handling and add the small HTTP-header assertion demonstrated by the surviving probe.
5. Add a production-build smoke path, targeted branch coverage reporting, and a supported-browser/fallback matrix. Consider performance/soak and live-provider checks separately according to product needs.

Keep the full unit suite in every PR. Its 1.8s local / 9s current-CI cost is small, and the regression probes demonstrate useful protection. No test deletion is justified by this audit alone.

## Audit data and reproduction

- [All 1,169 case durations and CI inclusion](test-cases.csv)
- [All 134 files, area, runtime and assessment](test-files.csv)
- [All 18 excluded browser cases](excluded-browser-tests.csv)
- [Isolated failure evidence and earlier shared-workspace observations](failures.csv)
- [Nine mutation probes and detecting tests](mutation-probes.csv)
- [CI job and setup timings across seven runs](ci-jobs.csv)
- [Simulated balanced shard assignments](proposed-shards.csv)
- [Machine-readable measurements](measurements.json)

Run `npm test -- --reporter=json --outputFile=/tmp/unit-results.json` for the unit report. For all browser cases, set `PLAYWRIGHT_JSON_OUTPUT_FILE=/tmp/browser-results.json` and run `npx playwright test --reporter=json`; the package's normal e2e script intentionally filters generation tests. Browser tests require Chrome and loopback access and own port 3100. CI artifacts supplied the per-case CI durations; job timestamps and logs supplied setup cost, retries and historical failures.

Raw local reports, logs, failure traces, downloaded CI reports and the temporary mutation workspace are retained locally in `/private/tmp/sparko-test-audit-2026-11-05`. The CSVs preserve the useful timing/inventory evidence without committing traces, media, or the temporary source copy. Timings are observations, not permanent performance budgets; remeasure after implementation, fixture, browser or runner changes.
