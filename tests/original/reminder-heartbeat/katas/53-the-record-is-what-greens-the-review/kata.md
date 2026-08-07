# The record is what greens the review check

**Rule (skills#46, check 14):** the check passes on the observed
write, never on the declaration. Here the summary says `reviews:
read` — a state that blocks on its own — and the decision store's
checkout gained a commit during the turn, so the persistence is
observed and the turn seals.

## What the fixture freezes

A green turn: thread declared and recorded in the ledger, the
decision store committed to during the turn, `reviews: read` in the
summary. The same declaration with an untouched store is kata 50.

## Expected

The turn seals and exits 0.
