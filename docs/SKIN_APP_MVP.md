# Current app skin adapter

The current Settings → Piano skin adapter uses the existing
[`worldmusicclub-skin` v1 format](SKIN_FORMAT.md). It adds an explicit import,
selection and reset flow; it does not define another portable skin format.

## Using the adapter

1. Choose a v1 `skin.json` file (at most 64 KiB).
2. Optionally choose its referenced background PNG (at most 2 MiB). Its filename
   must match the basename of the manifest's declared background asset path.
3. Choose **Import and use skin**. The previous skin stays active until validation
   and local persistence succeed. An invalid manifest or failed storage write
   leaves the previous selection and saved package intact.
4. Use **Installed skin** and **Use selected skin** to switch between the imported
   skin and built-in appearance. **Reset to built-in appearance** restores the
   app's existing presentation while retaining the imported skin for later use.

There is one imported slot. A successful new import replaces it. This picker does
not import ZIP archives, entire directories, remote URLs, or executable content.
The two file pickers can select `skins/original-midnight/skin.json` and
`skins/original-midnight/assets/woven.png` independently.

## Implemented scope

- Falling-note fills, text, outlines, circle/diamond/square/triangle role markers,
  and solid/striped patterns use the validated skin. Opaque note backplates keep
  the validated fill contrast over the shared notation lane. Existing note
  positions, lengths, input geometry and reduced-motion timing are unchanged.
  Role markers reserve their own visible band. An optional note-name label is
  omitted when its opaque backplate would overlap that band or leave the visible
  note body, including short notes and notes clipped at the viewport edges.
- White, black, pressed and playing piano keys use the validated key palette,
  including readable labels and a two-color focus outline. This applies to score
  practice and free piano playing. Guitar presentation stays built in.
- The palette background and optional PNG decorate the existing non-interactive,
  `aria-hidden` home artwork. The PNG is not painted behind notation, controls or
  falling notes. That home artwork is hidden by the existing small-screen layout.
  The stage resolver still reports `background_image` as unsupported; home
  decoration is a separate adapter result, not stage-background capability.
- Role swatches and attribution appear in Settings. The adapter does not claim
  complete persistent in-stage legend/accessibility acceptance.
- The score lane, notation ink, other palette fields and every declarative layout
  field remain built in. Settings describes that scope, and a changed portable
  layout produces the reader's `skin_feature_unsupported: layout_bands` diagnostic.
  It does not claim to render `notation_height`, `piano_height`, `side_margin` or
  `note_width_scale`.

The strict existing reader validates every field and all asset declarations,
including those this adapter does not render. Only the referenced background PNG
is offered by the picker; other declared resources are absent and diagnosed.
Missing, corrupt or unsupported PNGs use the specified solid-color fallback and
show a visible diagnostic. A missing bounded decoder also falls back to solid.
Metadata uses text nodes; imported values are never HTML, script, CSS expressions
or network destinations. The only image URL is a temporary blob URL from checked
local PNG bytes, revoked when the skin changes or resets.

## Persistence and boundaries

The adapter stores one atomic record in origin-local IndexedDB
`worldmusicclub.skins.v1`. It retains the validated manifest and exact accepted
PNG bytes, plus the explicit built-in/imported choice. Every restored record is
revalidated before display. Corrupt saved records start on built-in appearance
with a visible diagnostic. A successful explicit import/reset can replace them.

Persistence targets reopening the same origin in the same browser/WebView
profile. It is not native filesystem storage, a portable profile, synchronization,
or a promise that clearing site data or using a new browser profile retains the
skin. The native shell uses its stable `wmh://localhost/` custom-protocol origin;
native restart behavior still requires the platform acceptance gate. A browser
server opened on another port has a different origin.

No Rust API, score package, instrument configuration, performer assignment, input
mapping, audio renderer, recorder or score clock is changed. The existing
`worldmusichub.theme` preference and theme tokens are untouched. The built-in
appearance option restores the application's original renderer rather than
installing the portable default manifest as a new skin.

## Verification

Run `node --test tests/skin-format.test.js tests/skin-app.test.js` for manifest/PNG
budgets, imported-byte persistence, corrupt record handling, replacement/quota
failure, reset, localization, HTML injection, duplicate actions and bounded note
decoration. The app integration regression is
`tests/frontend-skin-app.test.js` once the small app/bootstrap patch is applied.

These Node tests do not establish browser visual, native Windows package or
accessibility acceptance. The integration owner runs the repository's complete
acceptance gates against the combined exact source before publication.
