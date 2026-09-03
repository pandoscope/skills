# Summary path set

The other half of kata 67, and the first kata to run the v2 path at
all: `TURN_SUMMARY_PATH` names a location outside the home directory,
the summary sits there, and no legacy file exists anywhere. One
variable is the entire agreement between wrapper, writer and reader
(skills#153) — so the kata layer has to prove the reader honors it,
not just the unit tests around `resolveSummaryFile`.

## What the fixture freezes

The clean turn of kata 03, with the summary at the path the variable
names and the legacy location absent.

## Expected

Exit 0, one seal appended, and the turn-summary verdict's detail is
"turn summary fresh" — no deprecation note, the legacy location never
consulted.
