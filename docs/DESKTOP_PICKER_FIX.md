# Hosted Windows file-picker correction, 2026-10-02

The first feature-acceptance run reached the native file chooser but did not
complete seed acceptance. This correction keeps the existing 240-second phase
limit and the actual Windows file-selection flow.

## Exact failed source and evidence

- Hosted source: `5347305632ce842baa75f0f11e9984475b242c14`
- Source tree: `d169e18ad64ecf4f7b1e7694f8b53b3a3cb19109`
- Equivalent local commit: `f784b2d48365b949ce6af95a2da3726a87edf136`
- [Run 37004752908](https://github.com/Goldgom/WorldMusicHub/actions/runs/37004752908), job `110830283055`
- Evidence artifact `11225817227`, ZIP SHA-256
  `4cc502b0a76aab4d242b55cb1698193eaa3b2c9ef6ec90d6f76c648c0e43a1c5`

The Windows implementation compiled and its actual-window startup smoke passed:
Rust compile/import, local OSMD SVG, expected application origin, one
EXE-owned listener sample of zero, and normal close. These results apply to
that source and do not constitute full feature acceptance.

`action-seed-2.json` is the first real file picker for `original-duet.mxl`.
`result-seed-2.json` records `ok: false` and
`Windows file-name control is not editable`. Action 1 had succeeded. The final
renderer report was absent and the outer PowerShell loop eventually reported
`Native seed exceeded 240 seconds`.

The old selector required filename host AutomationId `1148` to support
ValuePattern directly or to contain an editable child with AutomationId
`1001`. That lookup failed. The retained screenshot shows only the owning app
window and import panel; it cannot establish the native dialog's precise
control structure or whether the dialog remained open. A modal suspending the
renderer result poll is consistent with the lost terminal report, but is not
claimed as separately observed.

## Bounded correction

- Keep the existing `#32770` dialog-class and app root-owner check. Record the
  matched HWND, owning PID, class, root owner, app HWND and app PID
- Resolve edit controls only within the filename host `1148`. Wait up to five
  seconds for a unique enabled, writable ValuePattern edit; use the host itself
  only when it is an editable filename Edit/ComboBox with no descendant edits
- Refuse ambiguous candidates. Record a bounded inventory of candidate control
  types, AutomationIds, classes, enabled states, ValuePattern availability and
  read-only states. Do not copy displayed filenames or directory contents
- Set the approved fixture path through the native ValuePattern, verify its
  exact readback, and invoke the real Windows Open button
- On picker failure, attempt to capture that actual owned dialog, retain the
  action result, and terminate the host with the real action error immediately

No browser File object, DOM file-input assignment, direct import API or timeout
increase substitutes for the native chooser. App source, native permission
policy, profile identity, dependency graph and license bytes are unchanged.

## Validation boundary

The correction is prepared in a new worktree, leaving the failed source frozen.
Ordinary Node/Rust checks and source review run locally. PowerShell is not
installed on this Linux host; its parser and real UI Automation behavior are
validated by the next exact-source hosted Windows run. Until that run passes,
the new selector is a targeted correction with improved evidence, not a claim
that the hosted picker interaction has succeeded.

The five-second bound applies to polling. Individual synchronous UI Automation
provider calls are not independently timeboxed; the hosted run must establish
that the provider responds and exposes the intended filename control.
