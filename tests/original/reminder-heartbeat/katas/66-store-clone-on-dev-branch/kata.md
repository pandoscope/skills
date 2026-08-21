# The store clone rides the session's dev branch

**Incident:** orchestrator session, 2026-08-15
(session_014CUXJh1hKmW4ccUwRQ1Ep1), ticket
[meta#85](https://github.com/pandoscope/meta/issues/85). The harness
checked out the session's designated dev branch in every attached
repo — the three memory stores included. The session's first append
refused: the store guard (correctly) will not push HEAD to main from
a clone sitting on another branch. The repair took a manual
branch-compare, checkout, and fast-forward — mid-turn, under a Stop
hook block, by an agent that had never been told stores have a
different branch contract than work repos.

A work repo belongs on the session's branch — that is where the PR
grows. A store is written to, not developed on: appends push to its
default branch, so the clone must sit there. The harness applied the
work-repo rule to everything, and the guard downstream was left to
catch the difference one refused write at a time.

## What the fixture freezes

A store clone on a non-default branch that carries nothing beyond
origin's default (the attach-time state: behind, never ahead), a turn
declaring a thread event, identity set.

## Expected

The check distinguishes the two clone kinds. A store off its default
branch with nothing local is reconciled (or reported for SessionStart
to reconcile) — the append then succeeds with no manual git. A store
off-branch WITH local commits is the marked case: refusal stands, the
verdict names the branch and the commits, and never advises a
history-losing move.
