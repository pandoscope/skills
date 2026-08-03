# No turn summary

Not a harvested incident — the guard on the bridge, and it is stated as
such rather than dressed up as history.

The turn summary is what turns self-report into observed state: the
model declares which threads and tickets the turn touched, and every
later check becomes a mechanical diff of that declaration against what
was actually written. With no declaration there is nothing to diff, so
every other check silently has no work to do and reports a pass. That
is the failure shape this whole mechanism exists to remove, arriving
through its own front door — which is why check 1 runs first and why
its absence must be loud.

## What the fixture freezes

A turn that pushed real work and moved a thread, with no summary file
written at all.

## Expected

Check 1 fires. The turn is left unsealed, and checks 2 and 3 still
report their verdicts to the compliance log — a check that did not run
is not a check that passed.
