# Development batches and acceptance

The requested cadence is several meaningful feature commits with compilation and affected checks, followed by a cohesive full validation/repair checkpoint before main. This keeps interface work independent from unrelated native test repairs while preserving acceptance evidence.

## Fast development

Pushes to `dev/initial-prototype`, `integration/**` and `feature/**` run **Quick development checks**. They compile the Rust libraries and local server, run Rust library tests, check formatting and changed JavaScript syntax, and run baseline plus affected non-browser Node tests. The generated report explicitly lists the deferred suites and `accepted: false`. A green quick job is not full product or package acceptance. New commits may replace an older quick run on the same branch; full checkpoint runs are not cancelled by this policy.

Local intermediate commits use the same relevant compile/fast checks. Expensive tests may be deferred during a feature batch, not removed or silently relabeled. Author original UI regressions alongside changes and preserve an explicit list of unrun checks.

## Full checkpoint

Freeze a coherent commit and create a `validation/<checkpoint>` branch at that **existing exact SHA**, or explicitly dispatch the full workflows for it. This does not add a padding commit. The unchanged full general validation and native Windows feature acceptance run on that frozen source. General validation includes the entire Node suite, both Rust platforms, real browser, engraving and rhythm checks. Native validation includes actual input/file operations, lifecycle, package provenance and normal startup from the extracted archive.

Only after all required jobs and artifact checks succeed may that exact tested commit advance main with a normal fast-forward, and only then may its package be called accepted. A failure remains a failure, with its source and evidence retained. Repair with meaningful ordered commits and validate the repaired snapshot. Main itself also runs full general validation.

The existing every-50-commit Windows milestone workflow remains intact; the next normal milestone is 200. Keep its source immutable while its checks finish and run the native checkpoint alongside it. Direct chat/Library packages remain the delivery route while GitHub Releases are paused.

## UI previews

A functional UI preview may be shown earlier from an isolated integration branch with its source SHA, actual hosted Rust/browser screenshots and explicit incomplete checks. It is not an accepted Windows build or proof of hardware/audio latency. Preview screenshots must come from the implemented application at the stated viewport, not a static design or a different source snapshot. Keep the latest accepted package available separately.
