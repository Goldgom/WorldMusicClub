# Explicit build diagnostics

`GET /api/diagnostics/build` is a read-only, bodyless, same-origin endpoint on
the native protocol and loopback HTTP adapters. It does not parse a song or
change library data. Health responses retain their existing fields and shape.
An older application that lacks this route has unknown build identity; its
Cargo package version is not a source revision.

The version 1 JSON response has two independent objects:

- `compiled`: `package_version`, `source_sha`, `source_tree`,
  `source_commit_count`, `source_status`, `source_error`, and `target`
- `native`: `transport`, `process_id`, `os`, `arch`, `executable_path`,
  `executable_sha256`, `executable_bytes`, `executable_hash_status`,
  `executable_error`, `executable_checked_at_unix_ms`,
  `executable_hash_scope`, and `executable_cache`

`schema_version` is `1`. Source object IDs contain 40 or 64 lowercase hex
characters. The executable SHA-256 contains 64. Unknown values are JSON null,
never fabricated versions, zero counts, or values read from a neighboring
`BUILD-INFO.json`. Errors are bounded machine codes without system paths.

## Compiled source facts

The build script records the workspace repository's HEAD SHA, that commit's
tree, and complete reachable commit count. `source_status` is `clean`, `dirty`,
or `unavailable`; a dirty status qualifies the recorded HEAD, it does not turn
HEAD into an identifier of modified bytes. This is Git provenance, not a
cryptographic assertion about every compiler input or the page's current
assets. Ignored/generated files are not identified by Git status.

Source exports, missing Git, a mismatched repository root, hidden index flags,
legacy grafts, or failed Git reads produce unavailable provenance. Replacement
refs are disabled; caller Git environment overrides and fsmonitor are ignored.
A shallow checkout retains its SHA/tree/status but has a null count and
`source_error: "shallow_history"`. Git output is bounded at 64 KiB per command;
an oversized index inventory conservatively yields unavailable provenance.

The collector reruns on every Cargo invocation by declaring an absent input
inside `OUT_DIR`. This prevents stale provenance after a HEAD-only commit,
dirty or untracked source changes, restore, or removal of Git metadata, and
works in linked worktrees. Equal generated files retain their modification
time. Cargo still reruns the affected crate's rustc invocation after the build
script; this mechanism deliberately trades some incremental build work for
fresh identity. It does not scan the target directory.

## Running process and executable file

`transport` is `native-protocol-no-listener` or `loopback-only`. Process ID and
platform describe the responding Rust process. The OS supplies the executable
path; requests cannot choose a path. The first explicit diagnostic request
streams at most 256 MiB plus one overflow-detection byte. The digest, success
or error, and check time are cached for that process. Health and audio requests
never trigger hashing.

`executable_hash_scope` is `current_executable_path_file` and
`executable_cache` is `once_per_process`. The SHA-256 is a snapshot of the disk
file at that path, not a hash of loaded process memory. The timestamp is the
first snapshot attempt; a repeated request does not make it a fresh digest.
Each explicit read checks the current process path and file identity again.
Identity includes inode/device/change time on Unix, and volume/128-bit file
ID/change time on Windows, together with size and file times. Unsupported
Windows identity queries remain unavailable. Symlinks and nonregular files
are rejected before reading.

`executable_hash_status` is `ok`, `unavailable`, `too_large`, or `changed`.
Changes observed before/after hashing or after caching reject the digest.
A changed process path also clears the displayed path. No stale digest is
returned as current. Observations are a diagnostic snapshot, not a lock on
future file mutations or an attestation of loaded memory.

The full path may contain a user name. Display it only in the local diagnostic
view, and omit it from copied output unless the user explicitly opts in.
There is no upload or automatic clipboard operation.

## Local tests and remaining platform gates

The original temporary Git fixtures cover HEAD-only commits, tracked and
untracked changes, restore, exports nested in another repository, shallow
history, replacement refs, hidden index flags, grafts, and unchanged output
mtime. A dependency-free temporary Cargo project verifies the incremental
transitions without launching the application.

Runtime fixtures cover bounded SHA-256 reads, errors, first-read mutations,
same-size replacements preserving modification time, cached reads, changed
paths, and nonregular files. Native adapter tests independently hash the
running test executable and preserve the legacy health response.

These tests do not establish Windows GUI/package acceptance, browser usability,
or which executable a user currently has open. The Windows build and runtime
gate must verify this endpoint against the actual packaged process before a
package is described as accepted.
