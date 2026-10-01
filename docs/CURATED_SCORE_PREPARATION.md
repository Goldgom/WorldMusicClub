# Preparing a small verified repertoire

The three source-directory cards are guidance, not a complete playable library. This separate maintainer pipeline evaluates four complete nineteenth-century song editions from the primary [OpenScore/Lieder](https://github.com/OpenScore/Lieder) repository. They are candidates, not automatically bundled music.

The repository README and each selected MSCX copyright tag state CC0. [The pinned manifest](../catalog/sources/openscore-lieder-candidates.json) records immutable commit38c5db5, full source paths, exact SHA-256/byte counts, composer, original German lyricist, edition IDs, credits and links. No modern translation, commercial audio or third-party scanned page is bundled by this process. Preserve the original composer/lyricist and transcription credits. The corpus's license is not a blanket rights guarantee for other scores or countries.

The candidates are Brahms's *Wiegenlied* Op.49 No.4, Schubert's *An die Musik* D.547 and *Wandrers Nachtlied* D.768, and Clara Schumann's *Liebst du um Schönheit* Op.12. They add complete multi-part repertoire only if conversion/import and review succeed; this is not a claim that each arrangement fits any instrument unchanged.

## Reproducible converter boundary

Upstream explicitly documents free MuseScore CLI conversion of its MSCX files. The official [MuseScore3.6.2 release](https://github.com/musescore/MuseScore/releases/tag/v3.6.2) is pinned to AppImage160,305,128bytes and SHA-256`c59a41ee88bc7c565a939b9c73498ac0451bbd86574e95cb6e359302c1465290`; its release zsync SHA-1 was independently matched. The app is GPLv3 and is used only as a separately obtained build-time converter, never embedded in the MIT application or Windows ZIP. No synthesized audio/SoundFont is redistributed.

That historical AppImage includes only Qt's xcb platform plugin, so the local headless environment could not launch it. The hosted conversion job supplies an ordinary Xvfb display and standard distribution dependencies; it does not bypass a browser or operating-system warning. Converter mode uses fixed `-w -m -s -c … -o …` arguments, no plugins, no corruption-warning override, private home/config/cache directories, fixed source files and a 120-second deadline, 1 MiB logs and 128 files/64 MiB per-score outputs. Cancellation or an exception terminates the owned converter process group, including its launcher child. No user-machine installation or account is involved.

`Review pinned score candidates` runs only for changes to this fixed manifest, preparation script or workflow on the development branch. Its artifacts retain original MSCX, raw converter MusicXML, normalized import XML, source-rendered PNG, full compiler diagnostics, CC0 text and all hashes. The converter executable/cache is excluded from artifacts.

## Compatibility and acceptance

MuseScore's conventional external MusicXML3.1 DOCTYPE may require a recorded, exact-header removal in the **maintainer-generated import copy**. The original converter file is retained separately. Generic runtime MusicXML import still refuses DTD/entity declarations and is not advertised as universal MusicXML compatibility. A later broader compatibility feature requires its own explicit design/testing; this pipeline does not weaken it.

The first gate compares written pitch inventories without collapsing repeated/chord notes, then attempts normal Rust import. Those checks do not prove rhythm, voice allocation, expressive playback, fidelity of every printed instruction, or instrument compatibility. Source PNG and every diagnostic require review before catalog admission. An import failure is retained and the pipeline fails; no notes are dropped or substituted to make a candidate pass. Any future bundled canonical score must retain the verified source/provenance chain and surface its limitations.

Maintainers can reproduce with `xvfb-run -a python3 scripts/prepare-openscore-candidates.py --workspace /path/to/private-work --server-binary target/debug/practice-server` after building the app's normal offline assets/server. Preparation downloads only the pinned official converter and pinned corpus sources. It is not an application endpoint or a user-image upload service.

## Explicit held ledger and reference performance

The first all-candidate run at commit66 failed and remains recorded in the manifest/report. No work entered the catalog through that failure. Two editions contain unsupported grace notes; Clara Schumann's converter output gives several conflicting audio tempos whose offsets are visual-only by the MusicXML specification. These three works are explicitly **held**, with their exact source hashes, failure text and next review step. Their notes are not removed to obtain a passing import.

Later review jobs evaluate two separate conditions: a held work must still produce its declared refusal (an unexpected successful import or a different error requires review), while an admissible candidate must import with exact written pitch/event/rhythm/voice/staff/tie inventories and no unresolved tie warning. A green review job means those declared states were verified, not that all four scores became playable or were bundled. Every candidate remains listed in the artifact, including held files and errors. Only a separate admission decision can add a piece.

MuseScore also exports a separate reference MIDI. Its raw bytes/hash and either the full MIDI import result or a clear unsupported-control error are retained. When comparison is possible, the report separates canonical attacks, reference attacks, missed/extra events, matches within1ms, matches within the engine's10ms minimum matching window, and note-off duration differences. Duplicate/unison duration pairs are not guessed. Reference MIDI is software behavior, not acoustic sustain or the definitive musical performance: generated ornaments, fermatas, articulation, tempo rounding, expression/controllers and repeat choices may differ, and none of those mismatches are hidden as a generic accuracy score.

The source-rendered PNGs may have transparent paper; view them against white without changing the stored source images. Converter encoding dates and metadata can vary across runs, so output hashes identify the actual artifact; pinning the source/converter does not claim byte-identical regenerated files across dates.
