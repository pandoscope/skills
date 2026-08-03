# A decision was marked in the code and recorded nowhere

**Incident:** this session, 2026-08-03. Eight decisions were made while
building the heartbeat — the seal outside the state machine, one reason
per turn, the three-variable env contract — and every one of them lived
only in prose: PR bodies, a ticket comment, and the conversation. None
carried a `DECISION` marker at the line, and none reached the decision
store.

The cost is asymmetric in time. While the session is running the
reasoning is free to write down; after compaction it can only be
reconstructed, and a reconstructed prediction scores nothing — which is
the whole purpose of the record. So the reminder has to arrive in the
turn that made the decision, not at review.

## What is observable, and what is not

"You made a decision and did not mark it" is not decidable from
observed state — the skill's own rule is that routine changes are not
marked, and no check can tell an interpolation from a pattern-follow.
That half stays with the author.

"You marked a decision and recorded nothing" is fully observable on
both sides: the marker is a line added by this turn's commits, and the
record is a file in the decision store. This kata pins that half.

## What the fixture freezes

A clone whose commit this turn adds a `DECISION:ARCH` marker, and a
decision-memory clone that gained no record.

## Expected

Check 4 fires, naming the marker and offering the recorder. The
recorder session is not open in this fixture, so the command opens one
first — re-running `open` mid-session would branch off the default
branch again and strand the records already committed.
