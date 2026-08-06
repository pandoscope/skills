# The close-loop closed the declared thread first

**Incident:** this session, 2026-08-05, blocking the turn that
merged #88. The turn declared `epipe-early-close`; the merge's «Closes»
dispatched the close-loop, the bot's `completed` landed mid-turn, and
the ledger was already exactly what the turn produced. The check looked
only for session-anchored events, could not see the bot's, and blocked —
offering `reopened`, the one legal append from `completed`, which would
have recorded a state change that never happened.

The faster the close-loop gets, the more often an honest turn is
blocked: the mechanism working is what trips the check.

## The question the check actually asks

«Is the ledger current about what this turn touched» — not «did this
session hold the pen». A `by` writer is not a conversation and has no
bookkeeping to excuse; an event from another *conversation* still does
not count, because two sessions on one thread would otherwise excuse
each other's.

## What the fixture freezes

A turn that declares one thread, a session log whose last own event
predates the turn, and a bot `completed` for that thread stamped after
the turn boundary.

## Expected

The turn seals. The declared thread has a post-boundary event; that it
was written by the close-loop is the mechanism succeeding, not the
session shirking.
