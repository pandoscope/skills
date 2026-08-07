# A persisted claim with no record behind it

**Rule (skills#46, check 14):** a declaration widens detection and
never greens the check. `reviews: persisted` is a claim from the same
context that already believed the work happened; the store's checkout
is the observed state, and it decides.

## What the fixture freezes

A turn declaring `reviews: persisted` over a decision-store checkout
that gained neither a commit nor a working-tree change since the turn
began.

## Expected

The turn blocks once: write the record, or declare what actually
happened.
