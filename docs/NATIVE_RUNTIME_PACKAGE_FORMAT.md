# Future native runtime package format 1

Status: isolated prototype for future normal builds. No workflow uses this
format yet. No existing package was downloaded, rebuilt, split, or delivered
by this work. Synthetic contract tests are not native acceptance.

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

## Future workflow integration, explicitly deferred

Do not enable the runtime as the default artifact by changing only the upload
path. A subsequent coordinated change must:

1. Keep the entire existing full-package creation/verifier and all native,
   browser, Rust, formatting/clippy, and checkpoint acceptance gates intact
2. Update `docs/WINDOWS_NATIVE.md` so its copied README and START-HERE explain
   both distributions, the two inventories, required WebView2 installation,
   evidence access, and unchanged acceptance limits. The prototype's new guide
   qualifies existing full-package instructions; production docs must be
   consistent before the runtime becomes a default deliverable
3. Retain/upload the complete existing native package first, obtain its exact
   immutable run/artifact URL, and create the runtime from those same local
   bytes. No current or old denied artifact is fetched or rebuilt for this step
4. Extract and run normal startup on the runtime ZIP in a fresh location,
   verify the EXE hash is the one accepted earlier, and require normal close,
   expected controls/assets/catalog, correct origin, and no EXE TCP listeners.
   Preserve the existing full extracted-package check as well
5. Bind the runtime ZIP hash and final startup reports to source/tree, workflow
   run, full ZIP hash, and EXE hash in retained delivery evidence. The final
   acceptance summary must require this runtime startup outcome; no self-hash
   cycle is introduced by pretending post-packaging proof was already in the
   ZIP. Separately retained checkpoint evidence keeps its existing full scope
6. Upload an additive distinctly named Runtime candidate and its checksum;
   keep the complete Full/native candidate and all raw proof. Require the
   exact run's native/browser acceptance summary and same-source full Verify
   workflow before delivery or source promotion. Document the retention period
7. Exercise the new unit tests in normal checks and add workflow tests proving
   both uploads, their exact identities, the runtime startup gate, evidence
   retention, and unchanged final acceptance conditions

Publishing, GitHub Releases, signing, installer/updater behavior, a rebuild of
any existing candidate, and any artifact-transfer workaround are out of scope.
No workflow, acceptance adapter, or existing full manifest changes are part of
this prototype.

## Compatibility and smallest reviewable change

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

The minimum prototype commit is exactly three new files:
`native-runtime-package.py`, `test_native_runtime_package.py`, and this design
contract. It can be reviewed and unit-tested without building an executable,
running a server/browser, downloading production artifacts, or changing CI.
The test suite creates tiny original pseudo-PE headers and literal assets;
its substituted full-acceptance boundary is explicitly marked. A separate test
calls the real unchanged verifier and confirms it rejects the incomplete
synthetic package. Passing these tests never labels a Windows package accepted.
