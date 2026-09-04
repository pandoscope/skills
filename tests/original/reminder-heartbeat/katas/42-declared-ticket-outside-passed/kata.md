# The worker that wandered off its passed tickets

**Ruling:** D5 on [skills#179](https://github.com/pandoscope/skills/issues/179),
filed as [skills#181](https://github.com/pandoscope/skills/issues/181)
item 1. `passed.thread` and `passed.tickets` in the answers file are
the spawner's claim; the ledger is the record. A spawned session that
declares a ticket outside that list has drifted from what it was
spawned for — which may be right, and is the orchestrator's to judge,
not this hook's to block.

## What the fixture freezes

A clean turn in a session whose answers file carries
`passed.origin: spawner` and `passed.tickets: [pandoscope/skills#45]`,
declaring and writing to `pandoscope/skills#46`.

## Expected

The turn seals. The drift is printed — declared ticket, passed list,
origin — and nothing blocks. A principal-origin session has no passed
list and sees no check (kata 44).
