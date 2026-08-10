# A reason never yet delivered earns one more block

The loop guard exists so a hook cannot repeat a reason the model just
acted on — that is how a Stop hook traps a session. But the common
re-fire is not a repeat: remediating one check reveals the next.

**Measured, 2026-08-10**, over ten turns of one session: eight re-fires
fired on a check the block had never named. The model had acted on what
it was told and hit a new wall — silently, because the release wrote
nothing. Ten turns, zero seals, and nobody knew until the principal
looked.

So a check that has NOT been delivered this turn is worth one more
block. The guard still holds for a reason already given: that is the
loop it was built for.

## What the fixture freezes

This turn's first Stop blocked on `turn-summary`. The model wrote the
summary — that check now passes — and `ledger-event` fails, a reason
this turn has never carried.

## Expected

Exit 2 with the `ledger-event` reason, cycle 2, no seal.
