# One-command MIDI and VSQ conversion

This offline command converts an entire directory tree without launching the
application, playing audio, or making a decision for each song. It is independent
of a Windows EXE release. It uses the same authoritative Rust converters and
validators as the complete-score profiles.

From the repository root:

```sh
cargo run -p score-core --bin clean-song-batch --locked -- /private/originals /private/run-001
```

For repeated corpus runs, build once and invoke the executable directly:

```sh
cargo build -p score-core --bin clean-song-batch --locked
target/debug/clean-song-batch /private/originals /private/run-002 --compare /private/run-001/batch-report.json
```

On Windows the equivalent executable is `target\debug\clean-song-batch.exe`.
Quote paths containing spaces. The output's parent must exist; the output
directory itself must be new and outside the input directory. There is no
overwrite/resume switch. A new output name makes reruns independently inspectable
and leaves originals and previous results untouched.

Discovery recursively finds `.mid`, `.midi`, and `.vsq` case-insensitively, sorts
paths deterministically, and processes all files despite individual failures.
Symbolic links are not followed and are reported as discovery errors. Unsupported
extensions are ignored. VSQ recognition is based on framed authoring content in
the core decoder, so genuine VSQ stored as `.mid` uses `wmh-vsq-clean-v1`. Generic
MIDI uses `wmh-basic-keys-midi1-v1`. Recognized but invalid VSQ never falls back
to generic MIDI. Exact source SHA-256 hashes deduplicate aliases; the first
sorted source name supplies the display title. Every alias remains in reports.

## Output and privacy

```text
run-002/
  songs/
    <source-sha256>/
      metadata.json
      score.json
  reports/
    <source-sha256>/
      result.json
      result.md
  batch-report.json
  batch-report.md
  comparison.json        # with --compare
  comparison.md          # with --compare
```

Each song directory contains exactly the two required JSON files. `media: []`
declares that optional cover, background, video, mix and stems are absent. The
command never invents media, copies original MIDI/VSQ, copies raw archives, or
puts reports/debug records in a portable song directory. Compact structured
musical event records inside the complete score are validated profile data, not
an embedded original file. Source evidence contains format, length and hash.
Originals remain privately retained at their input paths; no source is changed
or deleted. Rights remain explicitly user-supplied and unverified.

Reports contain source filenames, aliases, track names and conversion evidence.
Keep the run directory private and export only the individual folders under
`songs/`. Zipping the entire run would include private reports and is not a
valid clean song pack. This command intentionally does not do that.

The output directory is claimed exclusively. Each song is written and synced in
staging, then renamed into `songs/` only when both JSON files are complete.
Individual failed writes do not publish a partial song. The final
`batch-report.json` is written last and marks a finished run. If it is absent,
the run was interrupted; complete songs already present remain independently
valid, but the corpus run is unfinished. Staging leftovers are private and must
not be exported. These are process-level atomic publication guarantees; the
command does not claim platform-independent power-loss durability.

## Reading the result

Both aggregate and per-song JSON include:

- Original source SHA-256, byte length and all source paths
- Profile, `complete` / `review` / `failed` status and explicit `data_complete`
- Source/retained event and attack counts, source tracks including silent tracks,
  determined ends, unresolved ends and zero-length attacks
- Exact musical positions and exact rational clock duration when available;
  default tempo use is disclosed by the core timing record
- `timing_review`, independent positive-duration `practice_coverage`, and
  independent rendition/acoustic capabilities
- `source_defect` when an invalid original program value is preserved exactly;
  legacy running-status dialect counts remain separately disclosed
- Package hashes, absent media, actionable issues and elapsed conversion time

`complete` means that a validated complete package was produced with determined
basic key timing. It does not mean every record is admitted as a playable
practice target or that a sound renderer reproduces the original. A zero-length
attack is retained exactly, counted explicitly and excluded from canonical
positive-duration notes; by itself it does not make conversion fail or require
review. Percussion key numbers do not establish instrument or acoustic pitch.

`review` means a complete package still preserves all source events/attacks,
while missing/ambiguous key ends or an unavailable relative clock limit practice
timing, or an invalid source program value needs an explicit defect label.
It does not trigger a prompt or stop the corpus. A generic converter
improvement can be followed by rerunning the entire corpus. The tool never
guesses FIFO/LIFO note pairing, extends zero-time notes, trims parts, or substitutes
an excerpt to improve a count.

`failed` means no package was published for that source. Original hashes and
actionable failures remain in the private report. A parse failure's source
coverage is unknown rather than zero. An unreadable file has no source hash and
receives a path-derived report identity.

For VSQ, attack coverage means authored vocal notes, with container MIDI-key
counts listed separately. All authored base notes and named engine meaning use
the existing clean VSQ profile. Reported practice duration is relative to the
premeasure origin and does not claim acoustic tails. Whole-vocal rendering
remains blocked; instrumental practice is a separate explicit receiver choice.
No rendition limitation alone causes source conversion to fail.

Exit status is 0 for all complete, 1 when any source fails or discovery has
errors, 2 for usage/setup/fatal output errors, and 3 when at least one package
needs review and none failed. A nonzero result is returned only after all
discovered inputs have been attempted, except fatal setup/report-write failures.
Standard error carries one status per unique source and a summary. Machine
consumers should read `batch-report.json`; logs are not a stable data interface.
Add `--json` to also emit that complete report on standard output after it has
been published; status progress still goes to standard error.

## Reproducibility and comparison

For the same converter, input bytes, path ordering and title, the two package
files and their hashes are deterministic. Reports additionally contain elapsed
times and the input root and therefore are not expected to be byte-identical.
`--compare` matches results by source hash and reports unchanged, changed, added
and removed records. It compares source coverage, timing, capabilities, package
hashes and statuses, ignoring elapsed time, root and aliases. Renaming the first
alias can change the title and metadata/score hashes and is correctly shown as
a package change. The original reports remain available for detailed inspection.

Public regression tests generate original synthetic MIDI and reuse the existing
original authored VSQ fixture. They cover recursion and duplicate aliases,
failure isolation, zero-time notes, unresolved releases, complete package
inventory and hashes, duration including silent ends, VSQ under a MIDI suffix,
safe reruns/comparison, and invalid output paths. No private music belongs in
the repository or CI. Corpus results do not themselves establish browser,
receiver or native Windows acceptance.

```sh
cargo test -p score-core --test clean_song_batch --locked
```
