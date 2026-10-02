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

## Second hosted result and native text route

[Run 37008095504](https://github.com/Goldgom/WorldMusicHub/actions/runs/37008095504)
tested source `146ab4b7adef00625abc0c7629d6b4b422322a5e`, tree
`13016014b74a1507aceeefe6a70564755d4016dd` (local equivalent
`1e861553777580a95b766bba7d204627167a7960`). Compilation and startup smoke
passed. The feature gate failed promptly with its actual seed/action-2 error.
Evidence artifact `11226988695` has SHA-256
`c67eb8eb484156be2dcd34d110529c878dc9852ce0c6984f7cf80a73d2f65189`.

The retained action result establishes an owned `#32770` dialog: dialog and app
PID are both 6924; root-owner and app HWND are both 262652. Within the first
AutomationId `1148` match, the only filename candidate is class `ComboBoxEx32`,
UIA `ControlType.Pane`, enabled, without ValuePattern or exposed child Edit.
That first-match inventory does not establish uniqueness across the dialog.
The actual owned-dialog screenshot shows a normal editable, focused File name
field. The missing UIA pattern is therefore the selector limitation; waiting
longer for that pattern is not the correction.

The working UIA path remains available. When it cannot resolve a writable
filename field, the corrected harness verifies the unique host's native class,
control ID, PID and dialog ancestry, then uses Microsoft's
[CBEM_GETEDITCONTROL](https://learn.microsoft.com/en-us/windows/desktop/Controls/cbem-geteditcontrol)
message to obtain that host's own edit HWND. It rejects a different process,
class, ancestry, disabled/hidden field or read-only style before entering text.
It does not search other native edit fields or type into an assumed focus target.

The native helper sends [WM_SETTEXT](https://learn.microsoft.com/en-us/windows/win32/winmsg/wm-settext)
and checks [WM_GETTEXT](https://learn.microsoft.com/en-us/windows/win32/winmsg/wm-gettext)
against the complete approved path. Each native query/text message has a
1000-ms [SendMessageTimeout](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-sendmessagetimeoutw)
bound. CBEM_GETEDITCONTROL passes no pointer payload; the two text messages use
Windows' system-message marshalling. Only the original finite fixture/download
names resolve to existing regular files. The harness still invokes the real
Windows Open button and waits for the app's actual picker/import result.

`tests/windows-desktop-contract.ps1` compiles the exact C# helper and tests pure
handle-ownership/writability and fixture-path contracts before the hosted Rust
build. It covers foreign owners/processes, wrong controls, disabled/read-only
fields, traversal/absolute/unapproved names, missing files, and directories;
spaces and Unicode in the test directory are retained. It creates no window,
uses no UIA, and sends no native message. These new Windows contract tests and
native text interaction remain unrun locally because PowerShell/.NET are not
installed here. The next exact-source hosted run supplies that evidence.

Both failed evidence archives and previous source trees remain preserved. No
product code, profile/origin, permissions, third-party license bytes or overall
phase timeout changed. This remains an acceptance-harness correction pending
Windows validation, not completed native feature acceptance.

## Third hosted result and host identity scope

[Run 37014715438](https://github.com/Goldgom/WorldMusicHub/actions/runs/37014715438)
tested source `f023cb9d2e05db382bb76408a784e64ee4c4f76d`, tree
`f99133582ffe1c7971de2c03314ac18cd8a57f93` (local equivalent
`879ba753ee4eb46eb42282ad56960094dd27b0e2`). The 113 pure helper checks,
compilation and startup smoke passed. Seed action 2 failed before text entry:
`Windows filename host 1148 is missing or ambiguous`.

The action result records three UIA descendants matching AutomationId `1148`,
not three verified native filename hosts. The existing `FindFirst` path records
one `ComboBoxEx32` candidate without ValuePattern; it never inventories the
other two ID matches. The inspected owned-dialog screenshot shows the real Open
dialog with an empty, focused File name field. The owned dialog and app PID are
both 5512, and their root-owner/app HWND is 197124. No file was selected.

The regression is the fallback's requirement that a descendant AutomationId be
globally unique. Microsoft's [AutomationId documentation](https://learn.microsoft.com/en-us/dotnet/api/system.windows.automation.automationelement.automationidproperty)
only expects sibling uniqueness. The evidence does not establish the other two
matches' classes, so this correction does not assume what they are.

The fallback now inventories up to eight ID matches with UIA and native HWND,
class, control ID, PID, ancestry and enabled/visible state. It selects only the
unique underlying HWND whose UIA and native identities both agree on the
app-owned `1148`/`ComboBoxEx32` host. Repeated UIA references to that verified
HWND collapse to one host; two distinct verified hosts still fail. The original
native target validation, host-owned Edit query, bounded text messages, exact
path readback and real Open invocation remain in place. Failure evidence
retains every bounded candidate's identity without copying directory contents.

Pure helper regressions cover repeated IDs with different native classes in
three orders, repeated references to one HWND, two distinct valid hosts in both
orders, missing/oversized inventories and every host identity constraint.
The nonhost classes used in these fixtures are synthetic cases, not a claim
about the unrecorded hosted controls. PowerShell/.NET are still absent locally;
these added contracts and actual picker acceptance require the next exact-source
hosted Windows run. All three prior failures remain preserved.

## Fourth hosted result and pending async waits

[Run 37019477445](https://github.com/Goldgom/WorldMusicHub/actions/runs/37019477445)
tested source `4f908bd409ac6c2714f127d0d313aa87d40700ee`, tree
`b9c81d84a5526e1b686fb89224ae925c6fb9b4e5` (local equivalent
`440e854ffeac969c58be0af9a1c9db628fad2345`). Compilation, startup smoke and
136 pure filename contracts passed. Seed action 2 now records `ok: true`:
the three ID matches are `ComboBoxEx32`, `ComboBox` and `Edit`; the unique
verified host yielded its own Edit, exact text readback passed and the real
Open control was invoked. Its result file is 2,309 bytes, below the existing
4,096-byte result limit.

The next action and final renderer report never arrived. After 240 seconds the
retained app screenshot shows the Import modal, with the OS picker closed.
These facts establish the completed native action, but not a file-change event,
successful import or renderer acknowledgment of the action result. The absent
report does not identify a host deadlock, file-read failure or parsing error.

Source review identified a definite timeout defect: `until` awaited each async
condition before inspecting its deadline. A pending result fetch or response
body could prevent the nominal 25-second timeout from ever being checked.
The correction races the complete operation against an independent 25-second
timer and aborts a timed-out request. JSON fetch/body operations and the final
report POST use the same bound. Native-result HTTP failures propagate directly.
Late predicate resolution cannot restart polling after cancellation. The outer
240-second limit remains necessary if the renderer's event loop itself stops.

Acceptance-only checkpoints now distinguish action POST acknowledgment, result
headers/body, actual picker change/cancel, API request/response/body, completed
compilation and final report submission. A host-side `trace-{phase}.json` keeps
the latest 128 request and checkpoint records with elapsed time. It records only
bounded stage/path/status/sequence metadata, never file contents or request
bodies. Host `reply-submitted` means the responder returned; separate renderer
checkpoints establish whether the browser received headers and parsed a body.
The trace is enabled only by the existing process-owned acceptance setup and
is preserved by the existing JSON artifact glob even if no renderer report
arrives. Native file selection and the product's import implementation are
unchanged.

Ordinary Node regressions exercise pending predicates, pending fetch/body
promises, cancellation races, late resolution, successful cleanup and error
propagation without launching a browser. Rust tests retain the existing result
size contract, reject nonmetadata progress and verify bounded trace retention.
The next exact-source hosted run must locate the remaining stall or demonstrate
actual import completion; this change is not a claim of full native acceptance.
