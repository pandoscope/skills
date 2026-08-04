# Observe mode: the same drift, measured and not surfaced

The baseline arm. The Hawthorne question — how much of the diligence is
the model and how much is the observation — cannot be answered by a
hook that always blocks, because there is no arm where the reminder was
withheld. `HEARTBEAT_OBSERVE` is that arm: every check runs, every
verdict is logged, and the turn is never blocked and never told.

Two invariants survive the mode, and this kata pins both. The failing
turn is **not sealed** — green seals, nothing else does, whatever mode
the hook is in; a seal handed out by observe mode would make the store
lie about which turns finished. And the verdicts logged are the same
ones blocking mode would have produced, because a baseline measured
with a different instrument is not a baseline.

## What the fixture freezes

Kata 01's exact drift state — the founding incident — with the observe
flag set.

## Expected

Exit 0, empty stderr, no seal, and a compliance record whose outcome is
`observed` with check 3's failure in its verdicts.
