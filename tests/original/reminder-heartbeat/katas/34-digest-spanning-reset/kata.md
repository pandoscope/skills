# A counter reset inside the window is a gap, never zero

**Incident:** this org's long sessions compact routinely — the
session that built the heartbeat crossed several compactions, and each
one rewrites the transcript, so the cumulative token counters the hook
stamps can move BACKWARDS between two seals. `costBetween` already
refuses to report that as data per turn; the digest must refuse the
same way per stretch. A silently zeroed span reads as a free stretch,
which is the one reading that is certainly wrong.

## What the fixture freezes

A compliance log whose previous seal recorded more cumulative output
than the rewritten transcript now shows, and a clean turn on top of it.

## Expected

Exit 0, one seal whose digest carries `tokens: null` and `reset: true`
— an explicit gap, with the stretch's other numbers intact.
