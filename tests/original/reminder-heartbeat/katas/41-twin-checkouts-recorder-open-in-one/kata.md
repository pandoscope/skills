# Two checkouts, and the recorder is open in one

**Incident:** the live container of 2026-08-04, twice. The platform's
session source held the store under the repo root while a workspace
twin sat on stale `main` — and hand-deleting the twin did not survive
the next resume, because the platform restores clones from snapshots.
Duplicates are permanent; discovery has to be correct with both
present, forever.

## The tie-break

The open recorder session marks the checkout where records land this
turn, by construction — `record.py open` stamps the state file in the
clone it will commit to. First-match would pick whichever the
directory walk yields, and picking the stale twin books a recorded
decision as missing.

## What the fixture freezes

A marker committed this turn; the repo-root checkout holding only the
seed corpus; a workspace twin with the recorder session open and this
turn's record written (untracked, exactly as the recorder leaves it
before its commit).

## Expected

The turn seals and check 4 reports **pass**: the open session names
the right checkout, and the record is there.
