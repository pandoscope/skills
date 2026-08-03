# The render workflow that failed 21 times out of 21

**BACKLOG** — the check this kata demands is not built. Frozen now,
while the evidence is on disk.

**Incident:** 2026-08-02. The store's workflow that renders `LEDGER.md`
had failed on every run since it was created — 21 of 21 — because it
sparse-checked-out the skill from a branch where the skill had never
existed. Nobody noticed for the whole of that time, because the agent
hand-rendered `LEDGER.md` at the end of every turn. The artifact was
always current, so the mechanism that was supposed to keep it current
could be entirely dead without producing a single visible symptom.

Absence and success looked identical, and this time the disguise was
manufactured by the very agent the automation was meant to relieve.

## What the fixture freezes

A turn whose checks are all green and which seals, over a store whose
rendered artifact predates the newest ledger event.

## Expected once the check exists

The artifact-freshness step of the seal protocol fires: after the seal,
a final block asks for the republish, and the next turn verifies that
the publish stamp is at or after the seal stamp.

## What is still undecided

Where the publish stamp lives. This fixture carries the rendered
artifact itself, so its mtime is available; a recorded stamp beside the
log would also serve. That choice belongs to the cycle that builds the
check, and the kata will need whichever it picks.

## Until then

The runner asserts the inverse — this heartbeat does **not** catch it.
The day the check lands, this test fails and the kata flips to
`"status": "active"`. That is the promotion backlog, executable.
