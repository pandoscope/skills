# Summary path unset

Not a harvested incident — coverage the suite owed itself. Every kata
runs the hook with `TURN_SUMMARY_PATH` absent from the environment, so
the whole suite was exercising the legacy fallback without one kata
saying so, or asserting what the fallback costs.

The cost is a marked verdict, not a silent pass: an unset path resolves
to the v1 location under the home directory, and the turn-summary check
reports the deprecation note in its detail. That note is the
measurement skills#159 names as gating the fallback's removal — the
tail of v1 reads in compliance logs is read from exactly this string.
When #159 lands, this kata's expectation flips from pass-with-note to a
loud failure, and that flip is the behavioral change under review.

## What the fixture freezes

The clean turn of kata 03, with the summary at the legacy location and
no `TURN_SUMMARY_PATH` in the environment.

## Expected

Exit 0, one seal appended — and the turn-summary verdict's detail
carries the deprecation note, not "turn summary fresh".
