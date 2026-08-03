# A marker from an earlier turn is not this turn's debt

Every repo this org works in will accumulate markers. A check that
looked at the working tree rather than at what the turn changed would
find them all, block on the first one forever, and be disabled by the
end of the day — the failure mode that kills reminders is being right
too often about things the turn cannot fix.

The turn boundary is what makes the check answerable: a marker added by
this turn's commits is this turn's debt, and one committed before the
boundary belonged to the turn that wrote it.

## What the fixture freezes

A clone carrying a `DECISION:ARCH` marker committed long before the
turn began, and a decision store with no record from this turn.

## Expected

Exit 0, one seal. Check 4 passes with nothing found.
