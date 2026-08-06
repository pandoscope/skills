# A green turn pushes the store itself

**Rule (skills#46, seal phase 3):** the checks gate the seal and the
seal gates the push. The seal line and the flushed diligence records
are the hook's own writes — the CLI pushes per append, and nothing
else ever carried what the hook wrote. Before this phase, every turn
ended with a manual fetch-rebase-push loop that raced the close-loop
bot ~5 times a leg.

## What the fixture freezes

A clean green turn whose store is a real clone with an origin — the
shape `ensure-stores.sh` leaves it in. Every earlier kata's store is a
plain directory, which also pins the tolerance: a store that is not a
clone is left for the next push, never a crash.

## Expected

The turn seals and exits 0 — and afterwards the store's working tree
is clean with zero commits ahead of its upstream: the seal reached the
origin with no manual push anywhere.
