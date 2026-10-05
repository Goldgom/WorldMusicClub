# Focused hosted check: delayed trusted keyboard input

This separate diagnostic uses a two-note original exercise, the unchanged app,
and actual Rust HTTP assessment. It does not replace any frozen-source gate or
claim physical keyboard/device, natural dense-page stall, or audio-latency proof.
No browser/server execution is allowed outside the authorized hosted runner.

The focused `Rhythm interaction preview` workflow runs this check on the
`preview/rhythm-controls` branch alongside the seven real rhythm layouts. It
preserves both report directories even on failure. This is a Linux browser
preview; Windows and the full accepted-package gates remain separate.

## Run in the hosted runner

Check out the exact commit containing this test. With the normal Node and Rust
toolchains installed, prepare the already-used dependencies and actual server:

```sh
npm ci --ignore-scripts --omit=optional
npm run prepare:engraving
node --test tests/stalled-keyboard-evidence.test.js
cargo build -p practice-server --locked
npx playwright install --with-deps chromium
WMH_HOSTED_BROWSER=1 \
WMH_SOURCE_SHA="$(git rev-parse HEAD)" \
WMH_SERVER_BINARY="$PWD/target/debug/practice-server" \
WMH_ARTIFACT_DIR="$PWD/test-results/stalled-keyboard" \
node scripts/hosted-stalled-keyboard-check.mjs
```

`GITHUB_ACTIONS=true` must come from the authorized Actions runner. Do not set it
locally to evade the launch guard. No native stdio driver is needed: the real
practice-server serves the unchanged assets and `/api/assess` directly. The test
does not intercept or stub network requests. Preserve the entire artifact
directory, including failure reports, after the step regardless of its outcome.

## What is required to pass

1. Import original C4 at 2,000 ms and E4 at 5,000 ms, with zero compensation and
   the unchanged 180 ms scoring tolerance. Start a real scored pass; manually
   assess it early with no inputs. Wait for the actual Rust result, visible
   feedback and recorder completion, then resume the same pass through Play.
2. Preserve both clock segments. Before two existing app animation callbacks,
   inject a measured 1,500 ms busy interval. This is a deliberate test fault,
   not a claimed measurement of production notation work. The original RAF
   argument and performance clock remain unchanged.
3. A browser-to-host binding announces each interval. The external Node process
   independently schedules normal Playwright/CDP keydown and keyup 300/400 ms later.
   The commands provide no timestamps. No DOM KeyboardEvent or dispatchEvent is
   used. Keyup is issued without awaiting keydown acknowledgment.
4. Require actual native KeyboardEvent instances, `isTrusted`, original event
   timestamps strictly inside each measured blocked interval, and callback
   receipts after the interval with at least 800 ms measured delay. Events
   outside the interval fail the check; the script does not retry or rewrite
   their timestamps. Focus, modal and visibility guards must remain satisfied.
5. The final block crosses the exact take endpoint and normal grace. Production
   drawFrame runs before the task yields to queued input, closes the pass, and
   submits revision 1 with just the first note. The last queued onset must still
   belong to that closed pass after its deadline, producing corrected revision
   2. Expect three real Rust snapshots: early empty baseline, endpoint with one
   hit/one miss, and the corrected two-hit endpoint.
6. Compare every stored onset and actual Rust hit time to the original event
   timestamp through the resumed exported clock segment, within 0.01 ms numeric
   precision. Check actual Rust target times/deltas, raw and receive clocks,
   correct ownership, releases, final revision parity, and no pending/error.
   Receipt-time substitution must differ by at least 800 ms and fail validation.

The baseline Rust response is fully completed before resumed input. The
endpoint revision-1 request is submitted before delayed final input; its response
may complete before or after that input. The report preserves the observed order
rather than claiming a stronger order than the browser establishes.

## Evidence and limits

`report.json` binds the source/tree, server binary and served input-path asset
hashes, browser version, host command timestamps, browser event timestamps,
handler/recorder processing timestamps, measured blocks, pass closure and
assessment snapshots. Original provisional/corrected take exports and a final
screenshot are separate files. Cleanup is required before a report can pass.

Playwright's Chromium CDP input commands exercise trusted browser events. This is
recorded as `input_driver: playwright-chromium-cdp`. It does not prove hardware
rollover, OS/device event loss, or how other browsers timestamp blocked input.
If Chromium only generates/delivers an event after the block, the overlap
requirement fails and must be reported as a gap/failure, not synthetic success.
The app is muted to keep this check about input retention and Rust scoring.

The pure Node tests use explicitly synthetic validator fixtures and rejection
mutations. Passing them validates the evidence checker, not the hosted result.
