# Reviews declared none, but a human commented

**Rule (skills#46, check 14):** the footer heuristic runs
observe-first on its own — but a declaration it contradicts fires.
The turn said no comments were read; the transcript shows a fetched
body without the attribution footer, which is the contract's
definition of a human comment.

## What the fixture freezes

A transcript slice holding a review-comment fetch whose body carries
no footer, under a summary declaring `reviews: none`. No memory store
is configured at all: the contradiction needs no store to be wrong.

## Expected

The turn blocks once, asking for the truth and the record.
