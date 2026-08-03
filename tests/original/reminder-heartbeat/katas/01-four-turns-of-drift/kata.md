# Four turns of drift

**Incident:** orchestrator session, 2026-07-30. The founding case behind
the check system (pandoscope/skills#46).

Immediately after writing the rule that makes the ledger the session's
open-work record, the same agent went four turns changing thread state
without appending a single event — while republishing the ledger page on
every one of those turns. Relative times recompute in the browser, so
"6 back" became "7 back" on every view and the page looked alive while
its content stayed frozen at 60%. The thread had reached 90% in reality.

Staleness and freshness presented identically. That is the class this
whole mechanism exists to catch, and priming had just failed against it:
the agent that forgot to append was the agent that had written the rule.

## What the fixture freezes

The turn commits and pushes real work on the thread `session-memory-store`
— the transcript carries the tool calls, the repo is clean and pushed —
and the ledger's newest event for that thread predates the turn.

## Expected

Check 3 fires: the ledger has no event for a thread the turn declared.
The reason names the thread and the exact `ledger append` command, and
the turn is left unsealed.
