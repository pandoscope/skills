# Clean turn

**Incident:** orchestrator session, 2026-08-03. The turn that merged the
ledger's post-merge-fixes PR: the work landed, the repo was pushed, and
the ledger got its `completed` event before the turn ended.

The passing kata. Without one, a check system is only ever observed
complaining, and nothing distinguishes "correct" from "fires at
everything" — the shape that made the render workflow's 21 consecutive
failures readable as normal.

## What the fixture freezes

A turn declaring one thread, a clone that is clean and pushed, and a
ledger event for that thread stamped after the turn began.

## Expected

Exit 0, no reason, one seal appended.
