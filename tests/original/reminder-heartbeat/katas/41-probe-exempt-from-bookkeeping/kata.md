# The probe that was held for the bookkeeping it could not do

**Incident:** 2026-09-03, [skills#181](https://github.com/pandoscope/skills/issues/181)
item 1. Six Routine-fired probe sessions measured the composer. Every
probe that pushed its result was held by this hook: check 3 demanded a
ledger event for the commit, check 5 demanded a fresh render and then
"republish the artifact" — and the probe, owning no artifact, guessed a
stray one and asked the principal for permission to overwrite it. The
probe's whole job was one commit and one answers file; the ledger and
the artifact are the orchestrator's.

## What the fixture freezes

A turn that committed and pushed to a clone with no ledger event, over
a store whose rendered page predates its newest event, in a session
whose answers file resolves `role: probe`.

## Expected

Both checks decline: verdict `unconfigured`, the role named in the
detail. The turn seals. A session without an answers file, or with any
other role, is unchanged — those cases are every other kata.
