# The command offered for a thread that cannot take it

Found by review (Fable, 2026-08-03) and measured. Kata 16 fixed this
for a thread with no history: it is offered `--ev opened` rather than
an impossible `--ev progress`. The test it introduced was "has this
thread ever appeared?", which is the wrong question — a thread that is
`blocked`, `parked`, `completed` or `dropped` has plenty of history and
still cannot take `progress`:

```text
illegal transition for "alpha": blocked -> progress.
Legal from here: unblocked
```

So the class was closed for one case and left open for four, which is
the more likely one in practice: a turn blocks a thread, a later turn
does related work and forgets to record it, and the hook hands over a
command that errors inside the single turn it allows.

The state machine already knows the answer. `currentStates` is exported
from the same core the hook already imports, and the transition table
names exactly what is legal from where — so the reason can offer a verb
that works instead of guessing one that usually does.

## What the fixture freezes

A declared thread sitting in `blocked`, with no event this turn.

## Expected

Check 3 fires and offers `--ev unblocked`, the transition the state
machine actually permits from `blocked`.

> **Format v2 (skills#153):** threads are observed from the ledger, not
> declared, so the declared-thread scenario this kata was born from can
> no longer occur. The fixture stands as regression over the v2
> behavior its expected.json now asserts — the turn resolves on
> observation (and on the ticket declaration, where one is staged).
