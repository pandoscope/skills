# A marker written this turn still owes its record, however it landed

The other side of kata 35, and the reason that fix cannot simply ignore
rebased commits: a branch authored during this turn and rebased before
it merged has both dates inside the turn. The reasoning was available
to write down, so the record is owed.

Without this case, the fix for 35 could be "skip anything a rebase
touched", which would switch check 4 off for every session that rebases
before merging — the majority of them here.

## What the fixture freezes

One marker commit **authored 21:02** and **committed 21:06**, both
after the turn began at 21:00, and a decision store that gained nothing.

## Expected

Exit 2, no seal, blocked on `decision-record` with the recorder's own
command — identical to kata 24, which models the same debt without a
rebase.
