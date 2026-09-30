# Iterative plan

1. Exact-time Rust score model, validation and original exercise fixtures
2. Portable loopback app, first playable piano with staff/jianpu and falling notes
3. Robust MusicXML import, retained original sources and diagnostics
4. Timing/pitch scoring, practice loops, tempo control and calibration
5. MIDI input simulation and hardware-compatible integration
6. Guitar fretboard, tuning/range adaptation and arrangement diagnostics
7. Windows CI artifact packaging and commit-50 release checkpoints
8. Accessibility, richer notation, session analytics and regression tests

## Known boundaries

- This is an evolving prototype, not a complete engraving or optical-recognition system.
- Imported MIDI cannot reconstruct every notation choice.
- Piano/guitar ranges and polyphony differ. Adaptations must be visible and reversible.
- Synthesized sound approximates an instrument; it does not reproduce every recorded timbre or expression.
- Catalog inclusion requires explicit provenance and rights; availability online alone is not permission.

## Milestones

Milestone progress is evidenced by git history, tests and runnable artifacts. No artificial commits count as development progress.
