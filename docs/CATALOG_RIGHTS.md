# Starter catalog: composition and edition rights

The `public_domain` module adds two **limited practice excerpts**, with note data newly encoded for WorldMusicHub. It does not contain complete critical editions, commercial-song transcriptions, third-party MIDI, recordings, scanned pages, or downloaded sheet-music assets. Reference scans were inspected for musical checking only and are not redistributed.

## Separate layers of rights

- **Underlying compositions:** selected as old public-domain melodies, with the historical evidence below. A modern arrangement, recording, edition, translation, or scan may have separate rights; the age of the melody does not license those materials.
- **New WorldMusicHub practice arrangements and note fixtures:** to the extent copyright or related rights exist in the project's new contributions, they are dedicated under [CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/). The score's `provenance.license = "CC0-1.0"` refers only to those new contributions. The attribution explicitly separates them from the underlying composition.
- **Application code:** remains covered by the repository's MIT license. The catalog's CC0 dedication is not a claim over the reference websites, their prose, images, or other editions.

This is a documented selection rationale, **not a legal guarantee in every jurisdiction**. Local copyright terms, related rights, and particular editions can differ. The [U.S. Copyright Office's duration guidance](https://www.copyright.gov/circs/circ15a.pdf) explains the historical published-work terms; it does not provide a worldwide clearance. Check intended distribution and use in the relevant jurisdiction if further assurance is needed. Neither a reference link nor a public-domain label implies endorsement by a library, archive, or publisher.

## `pd-ode-to-joy-opening`

**Identity and dates.** Ludwig van Beethoven's theme from the finale of Symphony No. 9 in D minor, Op. 125. [Beethoven-Haus Bonn's work record](https://www.beethoven.de/en/work/view/ag9iZWV0aG92ZW4tdml1cjNyEQsSBHdvcmsYgICA7NW57wkM/Symphony%20no.%209%20%26%2340%3BD%20minor%26%2341%3B%20op.%20125) identifies completion in February 1824 and links the original editions. The [UNESCO nomination for the autograph](https://media.unesco.org/sites/default/files/webform/mow001/beethoven_symphony9.pdf) identifies the first print as Schott, Mainz, 1826.

**Musical check.** The first eight bars of the initial low-string theme were checked visually against printed page 101 (PDF page 103) of the [1826 Schott first-edition scan](https://commons.wikimedia.org/wiki/File:Beethoven_-_Symphonie_Nr.9,_Partiturerstausgabe_1826.pdf), plate 2322. The historical score itself, rather than a recent beginner arrangement, is the reference. Its initial half notes and dotted-quarter/eighth cadences are retained. For a direct institutional reference to the edition, see [Beethoven-Haus, HCB C Md 6](https://www.beethoven.de/en/media/view/4818785626226688/Ludwig%20van%20Beethoven%2C%20Sinfonie%20Nr.%209%20%26%2340%3Bd-Moll%26%2341%3B%20op.%20125%2C%20Partitur%2C%20Schott%2C%202322?fromWork=5556714292117504).

**New practice choices.** Melody alone, moved from D major to C major and octave 4; no orchestration, lyrics, slurs, dynamics, or subsequent theme sections. The original cut time is represented as practice 4/4 at quarter note = 90. This is a deliberate new practice tempo and layout, not Beethoven's original performance direction. The excerpt has 26 notes, 8 bars, 32 quarter-note beats, and range C4-G4. It begins with one held E4 half note, as in the historical initial statement after transposition, rather than the rearticulated opening common in beginner versions.

## `pd-ah-vous-dirai-je-maman-opening`

**Identity and dates.** The anonymous traditional French melody “Ah! vous dirai-je, maman,” also familiar as the Twinkle melody. Mozart used it as the theme of Twelve Variations, K. 265/300e. The [Internationale Stiftung Mozarteum's Köchel record](https://kv.mozarteum.at/de/work/zwolf-variationen-in-c-uber-4057) dates Mozart's variations to Vienna, 1781-1782, and records the first edition in 1785. Those dates identify a documented historical setting; they are not a claim that Mozart originated the tune or that 1785 was the tune's first appearance. No Twinkle lyrics are included.

The tune's anonymous status and circulation in Paris by 1761 are also described in [Bärenreiter's historical preface, page 3](https://www.barenreiter.co.uk/prefaces/9790006524365_Innenansicht.pdf). That publisher's prose was consulted only for historical identity; its modern notation, arrangement, and fingering were not used. The [Library of Congress catalog](https://www.loc.gov/nls/services-and-resources/music-service-and-materials/piano-scores-braille/braille-composers-jacob-quilter/) identifies K. 265's air with the Twinkle title.

**Musical check.** The opening theme was checked visually in the [historical printed theme image](https://commons.wikimedia.org/wiki/File:Mozart_K_265.jpg). Its stated source is the score identified by IMSLP as *Mozarts Werke*, Series XXI, No. 6, Breitkopf & Härtel, 1878, plate W.A.M. 265; see the [edition listing](https://imslp.org/wiki/12_Variations_on_%27Ah%2C_vous_dirai-je_maman%27%2C_K.265/300e_%28Mozart%2C_Wolfgang_Amadeus%29). The old print's speculative 1778 composition heading is superseded here by the current Mozarteum dating. No modern edition's accompaniment, fingering, or other editorial work is used.

**New practice choices.** Opening eight bars only, melody in C major moved to octave 4, with accompaniment and written repeat omitted. Two G quarter notes in bar 4 become one G half note. Bar 7's D quarter note followed by a dotted-eighth D and sixteenth-note E is reduced to two D quarter notes. These explicit simplifications yield the familiar plain tune; they are not a lossless transcription of Mozart's setting. Tempo quarter note = 80 is chosen for practice. The excerpt has 14 notes, 8 bars of 2/4, 16 quarter-note beats, and range C4-A4.

## Reproducibility and guardrails

The two newly encoded excerpt fixtures live in `crates/score-core/src/public_domain.rs`; no external asset is fetched at runtime. Each generated `Score.source` retains the project's fixture JSON, including the exact pitch/duration tuples, the CC0 edition notice, verified reference URL, and editorial changes. It is labeled `worldmusichub-practice-fixture-json`, not a historical-source file or imported scan.

Tests check validation, compilation, exact rational duration totals, expected note counts, playable pitch ranges, stable unique IDs, complete scoped attribution, and source-fixture preservation. New catalog additions require their own composition and edition evidence; a familiar title or search result alone is insufficient. Commercial repertoire should remain metadata-only unless the actual music/arrangement rights have been established.

Reference pages and historical notation checked on 2026-09-30.

## Complete CC0 written-note practice edition: Schubert D.768

`cc0-schubert-wandrers-nachtlied-d768` adds all 14 measures of *Wandrers Nachtlied*, D.768, for voice and piano. Composer Franz Schubert and the original German lyricist Johann Wolfgang von Goethe are identified by the pinned source. The selected [OpenScore Lieder edition lc6486443](https://musescore.com/openscore-lieder-corpus/scores/6486443), credited to pental, carries CC0 in the original source and repository license. Its upstream reference is IMSLP #16364; no scanned page, modern translation, recording or SoundFont is included. This edition's permission is separate from the application's MIT code license and from other editions/countries' rights.

The immutable corpus commit, original MSCX SHA-256, exact converter version/hash, raw MusicXML/hash, import-copy/hash, MIDI/hash and complete license are preserved in `catalog/editions/cc0-schubert-wandrers-nachtlied-d768/provenance.json` and the canonical score's retained source envelope. Only the fixed conventional external DOCTYPE is removed in the import copy; the raw converter XML remains unchanged. Catalog ID/attribution changes are documented. No pitch, rhythm, voice, staff, tie, tempo, key, meter, repeat or original part name is altered to fit an instrument.

**Checked scope:** source-to-converter pitched-note inventory matches (324). Converted MusicXML-to-canonical validation preserves 334 explicit written events, including 10 rests, with exact rational onset/duration, spelling, voice, staff and tie flags. Three tied continuations form 321 playback events. Source-only material remains archived rather than claimed as implemented canonical semantics. The evidence is reproducible, but is not an independent critical-edition review of every MSCX engraving instruction.

**Expressive limits:** the two turn ornaments generate six extra attacks in MuseScore's reference MIDI. Two fermatas generate tempo changes; this app keeps the explicit 38.5 BPM map. Dynamics, slurs, articulation, lyrics, engraving details and MIDI controller/program behavior are not completely reproduced. The raw reference comparison keeps its timing and key-release mismatches visible in `docs/evaluations/openscore-d768-reference-77.json`; it is not an equivalence score. All these warnings survive JSON saving/reopening.

**Instrument limits:** the unchanged piano spans MIDI 29–65 and does not fit the default 61-key C2–C7 range. Voice spans 65–77. Choose a suitable keyboard/part or an explicitly confirmed reversible octave copy. Listen/display/source export remain available; impossible scored targets must not be made playable by silently dropping low notes.

The portable Windows package includes the `catalog` folder and its asset licenses in addition to the embedded offline canonical data. JSON export preserves the retained originals; generated MusicXML/Jianpu alone is not a full source archive.
