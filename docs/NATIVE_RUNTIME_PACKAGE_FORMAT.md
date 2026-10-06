# Future native runtime package format 1

Status: additive integration for future ordinary builds in
`windows-desktop-acceptance.yml`. No existing package was downloaded, rebuilt,
split, or delivered by this work. Local synthetic contract tests are not native
acceptance; the first actual Windows runtime startup and full checkpoint remain
required before offering a future Runtime candidate.

## Artifact boundary

The current Windows workflow stages the EXE, documentation, schemas, catalog,
licenses, notices, required license source archives, and native proof under
`WorldMusicClub-Native/`. `native-release-manifest.py create` checks the exact
source/tree/EXE and proof; `archive` checks the complete ZIP. The extracted
portable startup check runs afterward. Browser/native acceptance summary and
full `Verify WorldMusicClub` checks are separate mandatory gates.

Future normal builds may additionally produce a default runtime ZIP. The
complete original native ZIP remains retained under its existing identity and
passes its existing verifier. All separately retained browser/native raw proof,
final extracted startup proof, and full checkpoint evidence remain mandatory;
the full native ZIP is not the entire checkpoint's evidence collection.

The runtime ZIP has exactly every full-inventory member outside `evidence/`,
plus the new runtime metadata and guide. This is a lossless partition by one
explicit namespace, not a short list of assets chosen to fit a transfer limit.
Any future asset outside `evidence/` is retained automatically. Licenses,
notices, MPL source archives, catalog rights/provenance, schemas, and instructions
are never moved to evidence or pruned. Runtime dependencies must never be put
under `evidence/`; a future workflow test and extracted-package startup check
must enforce that boundary. There is no size target and no automatic further
pruning if the runtime ZIP is still too large.

Only original, reviewed, redistributable test material belongs in either
artifact. The split does not authorize bundling user music or WebView profiles.
The prototype reads local files only, never follows metadata URLs, never
starts an EXE, and never downloads an artifact.

## Versioned manifest and integrity chain

`RUNTIME-MANIFEST.json` has the exact format identifier
`worldmusicclub.native-runtime` and integer `format_version: 1`. Unknown
versions, unsupported full-inventory versions, extra manifest fields, unsafe
paths, raw ZIP names changed by decoder normalization or NUL truncation,
Unicode path aliases in ZIP extra metadata,
Windows device names (including console, superscript COM/LPT, and
space-suffixed device-stem aliases),
duplicate or Windows case-colliding names, symlinks, special files,
encrypted entries, and directory records (including the DOS directory bit
without a trailing slash) fail closed. ZIP members,
counts, JSON metadata, and total expanded bytes have explicit bounds; these
are parser safeguards, not distribution-size promises.

The manifest records:

- Exact Git commit, Git tree, and full-history commit count from the unchanged
  full `BUILD-INFO.json`
- The fixed EXE path, byte length, and SHA-256 from the same inventory
- Every retained runtime file's path, length, and SHA-256, including all license
  and documentation files and every unfamiliar non-evidence asset
- The full ZIP's filename, SHA-256, byte length, and bounded typed
  `github-actions-artifact` locator: repository, source commit, workflow run
  ID, and artifact ID. Source and run must match the full build manifest. An
  optional convenience URL must be exactly the corresponding HTTPS GitHub
  artifact page; credentials, queries, fragments, local paths, and other
  schemes are forbidden. The locator identifies the upload containing that
  ZIP, not the outer GitHub artifact wrapper; the digest identifies the exact
  inner ZIP. No mutable `latest` link or automatic fetch is used
- The partition rule, excluded namespace, evidence-file count and byte count,
  and location of the complete original inventory. Omitted evidence paths and
  individual hashes remain visible in that inventory
- Explicit `acceptance_scope: native-windows-only` and
  `checkpoint_acceptance: not-asserted`

The runtime retains the exact original `BUILD-INFO.json` and puts the original
full checksum list at `FULL-SHA256.txt`. Keeping the full inventory makes every
omitted evidence member inspectable. `BUILD-INFO.json` still describes the FULL
package: older consumers must not treat it as the runtime ZIP's inventory.
The runtime's `SHA256.txt` covers every runtime payload file and the new
manifest, while the external `.zip.sha256` covers the complete runtime ZIP.
The new `RUNTIME-PACKAGE.md` explains both inventories and the evidence link.

The runtime verifier re-derives the complete retained file set from the original
full inventory and compares it exactly against the new manifest and actual
ZIP. Updating only the runtime checksum list cannot hide a missing file or
change the bound EXE. An attacker who controls the package and all supplied
hashes can replace them together: hashes are not signatures. Obtain the outer
runtime ZIP digest from a trusted workflow/release record, and establish the
source/run/repository relationship there. A locator is descriptive metadata,
not independent proof that a GitHub upload exists or belongs to a source. The
verifier therefore requires an explicit
`--expected-sha256`; it never treats its own sidecar as a trust root.

## Commands and verification outcomes

Future creation, in the clean checkout for the exact accepted build source:

```sh
python scripts/native-runtime-package.py create FULL.zip RUNTIME.zip \
  --commit EXACT_COMMIT --tree EXACT_TREE \
  --evidence-reference https://github.com/OWNER/REPO/actions/runs/RUN/artifacts/ARTIFACT
```

The full ZIP must already exist from that normal build. Creation checks its
source/tree, every member hash, original inventory/checksums, and digest; it
calls the unchanged full native verifier using the matching clean source
checkout. Validation failure publishes no candidate ZIP. It verifies the new runtime
ZIP and stages its checksum before publishing each complete file with an
exclusive same-filesystem hard link. Existing files are not replaced. An I/O
failure rolls back only links this operation created; a separate cleanup
failure is explicitly reported. Filesystems without hard-link support fail
closed. The ZIP/checksum pair is not a filesystem transaction: interruption
between the two publications may require recovery, and consumers must require
both files rather than treating a lone ZIP as a completed delivery.
Creation is not exposed as a weaker `skip evidence` operation.

A consumer can check runtime integrity without the large evidence archive:

```sh
python scripts/native-runtime-package.py verify RUNTIME.zip \
  --expected-sha256 TRUSTED_RUNTIME_ZIP_SHA256
```

The result says `runtime_integrity: verified`,
`full_native_evidence: not-revalidated`, and
`checkpoint_acceptance: not-asserted`. This confirms structural/hash identity
relative to the supplied trusted digest. It does not independently re-run the
native proof and cannot establish its availability or workflow success.

A reviewer can additionally audit native evidence entirely offline:

```sh
python scripts/native-runtime-package.py verify RUNTIME.zip \
  --expected-sha256 TRUSTED_RUNTIME_ZIP_SHA256 --full-archive FULL.zip
```

This requires the exact source checkout, complete full ZIP, and dependencies
used by the existing verifier (including Node and the corresponding scripts
and original fixtures). It checks the full ZIP's length and digest, invokes
`native-release-manifest.py`'s existing `verify_archive`, requires exact source
and EXE/inventory identity. Before the legacy verifier reads any payload, the
new adapter checks bounded ZIP inventory, exact preserved full metadata bytes,
source identity, and every declared member length. Oversized or mismatched
archives never enter the legacy decompression/proof path.
The existing full verifier writes/replaces its usual full ZIP checksum sidecar;
no archive payload is modified. A missing file, expired remote link, different
archive, dirty/mismatched checkout, missing verifier dependency, or proof error
cannot become an audit pass or fall back to runtime-only success. Success says
`full_native_evidence: revalidated`; checkpoint acceptance remains unasserted.
This is proof revalidation, not another GUI run or an audible playback test.

Offline artifact availability is optional for ordinary users; complete
source/run-bound proof retention and verification are mandatory for producers
and reviewers. Evidence must remain downloadable for at least as long as the
runtime is offered. GitHub artifact expiry makes a runtime unsuitable for
continued accepted distribution unless the exact bytes are retained at an
approved durable destination. Do not silently replace expired evidence with
newly generated proof for an old runtime.

## Future ordinary-build workflow integration

The full native ZIP, verifier and ordinary extracted startup remain unchanged
in scope. All native, browser, Rust, formatting/clippy and full checkpoint gates
are retained. The existing Full/native candidate artifact name is preserved.
After successful full verification and startup, the workflow uploads that Full
ZIP and its checksum, obtaining the immutable artifact ID from the upload step.
Runtime creation uses only those same local full ZIP bytes and requires the
upload's artifact URL to match the current repository/run/artifact identity.
There is no old-artifact retrieval, metadata fetch, alternate download route,
second executable build or acceptance bypass.

An independent verifier checks the Runtime ZIP against the hash exported by
its producer step. `windows-native-runtime-smoke.ps1` then invokes
`native-runtime-delivery.py extract`, which requires the same trusted digest,
source/tree, repository/run, Full artifact ID and the pre-upload Full ZIP digest. It checks the checksum pair,
verifies every ZIP member, and extracts exclusively into a new directory. The
extracted tree must contain exactly all Runtime files and required directories,
without links, junctions, added files or missing assets. The existing
`windows-native-portable-smoke.ps1` runs the extracted EXE ordinarily: enabled
Single player home control, real rendered window, no EXE TCP listeners, and
normal close. No acceptance hooks or redirected WebView profile are enabled.
Catalog, notices, source archives and unfamiliar assets must still match the
complete retained inventory; the original Full acceptance supplies their
functional proof for the same exact EXE.

Origin is deliberately scoped: the ordinary UI Automation startup does not
read `location.origin`. The delivery verifier independently revalidates the
same-source Full evidence and requires both Full startup reports to bind
`https://wmh.localhost` to that exact EXE. Its record explicitly reports
`ordinary_startup_origin_observed: false`; it does not invent a new observation.

After startup, `native-runtime-delivery.py create` and `verify` independently
recheck the archives, complete extracted Runtime tree and both final startup
report/screenshot/log inventories. The retained `delivery.json` binds source,
tree, count, run, repository, Full artifact/ZIP, Runtime ZIP and EXE hashes. The
normal startup reports include their actual executable/extraction paths and
workflow run, so copying Full's report cannot satisfy Runtime's fresh-path
check. Failed, stale, missing or overclaimed reports fail closed. This metadata
is retained outside both ZIPs; there is no post-packaging self-hash cycle.

Only after those checks succeed does the workflow upload the distinctly named
`WorldMusicClub-Native-Runtime-Candidate-*` ZIP and checksum. It retains Runtime
startup JSON, PNG and log files plus the delivery record in
`native-runtime-delivery-evidence-*`, including available diagnostic files after
failure. All original raw Full/native/browser proof uploads remain. The final
summary requires all added outcomes and distinct Full, Runtime and Runtime-proof
artifact IDs, records trusted Runtime/delivery digests, and still requires the
separate full Verify WorldMusicClub workflow for the same source before delivery
or main promotion. Neither uploader labels a package accepted by itself.

The workflow requests the same 90-day retention for Full, Runtime and all its
raw proof. Actual repository policy can shorten it. Check actual availability
and separately retained full-checkpoint evidence before delivery. Runtime must
not remain offered after any required exact evidence expires unless all exact
bytes are retained at an approved durable destination. No automatic renewal,
rebuild of old proof, publication, installer, signing or updater is introduced.

Normal Python test discovery runs the original package contract tests and the
new extraction/delivery/workflow tests. Tests use only tiny original synthetic
files and explicit substitutions for full semantic acceptance. They do not
start a Windows executable, run a GUI, or qualify any artifact for delivery.

## Compatibility and scope

Keep the extracted folder and EXE names unchanged; native app identity, profile
origin, saved music, and migration behavior are unaffected. Download names must
clearly distinguish Runtime from Full. Older full-package consumers continue
using the current complete archive and verifier. Running the legacy full
verifier on a runtime ZIP must fail because evidence is absent; never add a
fallback accepting runtime inventories in the full verifier.

Runtime format 1 selects every non-evidence file. A future change to namespace,
required runtime content, evidence semantics, source identity algorithm, or
manifest meaning requires an explicit format/version review and migration.
Unknown versions are rejected. Filename changes or new required third-party
license material cannot be used to drop files from older full inventories.

The original prototype remains an independently verifiable package format.
The integration adds an offline delivery helper and ordinary Windows startup
wrapper without modifying the full native verifier. Synthetic tests explicitly
mark their substituted full-acceptance boundary, and a real-verifier negative
case rejects incomplete synthetic evidence. Passing these tests never labels a
Windows package accepted.
