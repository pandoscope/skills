# The ticket still open after its PR merged

**BACKLOG** — the check this kata demands is not built. Frozen now,
while the evidence is on disk.

**Incident:** 2026-08-03. A PR merged and its ticket stayed open. The
session did not notice; the principal did, and said so — "still open in
ledger" — and only then was the merge state verified and the thread
closed at 100%.

Every ingredient of the drift was already local. The transcript held
the merge call and held no issue-write call afterwards, and the turn
knew which ticket it was working on. Nothing about catching this needed
the network; it needed something to compare the declaration against the
calls actually made.

## What the fixture freezes

A turn that declares a ticket, merges its PR in the transcript, and
makes no issue-write call — with every built check green.

## Expected once the check exists

Check 4 fires: a declared ticket the turn moved on GitHub without
recording it there.

## Until then

The runner asserts the inverse — this heartbeat does **not** catch it.
The day the check lands, this test fails and the kata flips to
`"status": "active"`. That is the promotion backlog, executable.
