# The passing case: marked and recorded in the same turn

Without it, check 4 is only ever observed complaining, and nothing
separates "correct" from "fires whenever code changes" — the shape that
made the render workflow's 21 consecutive failures readable as normal.

It also pins the direction of the check. The turn commits a marker AND
a record; nothing about the code diff alone may block it, because most
commits are routine by the skill's own rule and a check that nagged
every commit would be turned off within a day.

## What the fixture freezes

The same marked commit as kata 24, and a decision-memory clone that
gained a record file during the turn.

## Expected

Exit 0, one seal. Check 4 passes because the record exists, not because
it was not looked for.
