# A repeated first check hides no later one

**Rule (skills#242):** on a guarded fire the hook blocks on the first failing check whose reason was not delivered this turn.
It releases unsealed only when every failing check's reason was delivered.

## What the fixture freezes

This turn's first Stop blocked on `tickets-updated`.
On the re-fire `tickets-updated` still fails first, and `response-hygiene` fails too,
because the response names `skills#97` without its link.
That reason was never delivered this turn.

## Expected

Exit 2 with the `response-hygiene` reason, cycle 2, no seal.
A hook that looks only at the first failing check finds `tickets-updated` delivered and releases the turn unsealed,
so the unlinked ref never reaches the model.
