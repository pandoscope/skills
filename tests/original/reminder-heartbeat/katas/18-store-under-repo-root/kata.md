# The hook blocking on its own writing

Found by probing (2026-08-03). Put the session-memory clone where the
session's other clones live and the heartbeat deadlocks against itself:
it seals — a write into that clone — and from then on check 2 sees an
uncommitted store and blocks. Every turn. Forever, because the thing
making the clone dirty is the hook doing its job.

It does not bite the current deployment, where the stores sit in
`/workspace` and the repos under the session root. It is one
configuration change away, and it would present as the heartbeat
demanding a commit nobody can satisfy.

The store is not the session's work; it is the hook's own output. The
script owns those commits, and pushing them is the seal protocol's
third phase (skills#46), which is not built. Until it is, check 2 must
not report on the clone the hook itself writes to — reporting a clone
whose only change came from the reporter is not observation, it is an
echo.

## What the fixture freezes

The store as a git clone sitting inside the repo root, with the hook
pointed at it.

## Expected

The turn seals and exits 0. Check 2 passes, having skipped the store,
and the store's dirtiness is left to the phase that will own it.
