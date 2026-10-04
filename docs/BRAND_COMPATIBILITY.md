# WorldMusicClub name and data compatibility

The project and current product name are **WorldMusicClub**. The canonical
repository is [Goldgom/WorldMusicClub](https://github.com/Goldgom/WorldMusicClub).
This is a rename of WorldMusicHub, not a new music library or score format.

New browser portable packages use `WorldMusicClub-Windows-x64-*.zip`, the
`WorldMusicClub/` folder and `WorldMusicClub.exe`. New native portable packages
use `WorldMusicClub-Native-Windows-x64-*.zip`, the `WorldMusicClub-Native/` folder
and `WorldMusicClub-Native.exe`. Their build manifests, file inventories, ZIP
checksums and extracted-startup checks use those same names. The two editions
continue to have separate runtime and storage behavior; see the
[browser guide](WINDOWS.md) and [native guide](WINDOWS_NATIVE.md).

## Existing music and preferences

The rename deliberately preserves these identities:

- Native application identifier `org.worldmusichub.desktop-proof` and origin
  `https://wmh.localhost`, which select the existing WebView profile
- Native score directories, including `%LOCALAPPDATA%\WorldMusicHub\Scores`,
  and the corresponding `WorldMusicHub/Scores` paths on other platforms
- Browser databases and settings keys beginning with `worldmusichub`, including
  score/performance libraries, language, themes, MIDI choice and latency
- Score/song/backup format names, schema namespaces and filenames, `wmh` profile
  identifiers, and existing backup/export filenames and extensions
- Canonical producer metadata (`WorldMusicHub`), exporter software labels,
  original-source bytes, catalog credits and fixture provenance
- The `/api/health` protocol identity `name: "WorldMusicHub"`; current builds
  additionally report `display_name: "WorldMusicClub"`
- Internal Cargo package/binary names and `WMH_*` configuration/test variables;
  packaging copies the built executables to the current public filenames

Do not rename these data directories or edit saved music just to match the new
brand. Existing files keep their original format and provenance. Moving to a
different browser origin or between the browser and native editions still
requires the explicit backup/restore workflow described in their guides.

## Historical releases and verification

Already published WorldMusicHub ZIPs, executable names, version output, source
SHAs, checksums and acceptance reports remain historical evidence. Run the EXE
actually included in an older ZIP and use that release's instructions and
source-matched verification tooling. Current package scripts create and verify
the new WorldMusicClub package layout. A new name does not imply that an older
binary contains newer source changes, or that a newly built package has passed
Windows acceptance. Check `BUILD-INFO.json` and the exact source's CI results.
