# The hook's own feedback is a user turn

The defect this kata exists to prevent, and the fixture gap that hid it.

Every check measures "this turn" from `lastUserTurnAt`, and the block
feedback this hook writes reaches the model as a user turn carrying its
own timestamp. So on the guarded fire the boundary moves PAST the work
the turn did, and all thirteen checks silently re-measure a turn that
now contains nothing. `countUserTurns` moves with it, which pinned the
cycle counter at 1 forever.

**Measured, 2026-08-10**: `ledger-event` passed on a turn's first Stop
("1 threads recorded") and failed twelve seconds later on the re-fire
("no event this turn") — same store, same append, which simply preceded
the feedback.

No kata could catch it, because every kata transcript stopped at the
model's own last turn. The fixture never contained the message the
platform actually injects, so `msg` never moved and the counter looked
correct. This transcript carries it.

## What the fixture freezes

The 62 state plus the injected feedback turn, stamped after the work.
`lastUserTurnAt` now returns 14:33; the turn still began at 14:30.

## Expected

Unchanged from 62 — exit 2, cycle 2 — because the boundary is inherited
from the record the opening fire wrote, not recomputed.
