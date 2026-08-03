# A turn that did the work and declared none of it

Found by probing the built heartbeat against scenarios no kata covered
(2026-08-03). The turn committed and pushed real work, wrote a current
turn summary declaring **no threads**, and sealed. Exit 0, silence.

Every check held. Check 1 saw a fresh file. Check 3 had nothing to
diff, because check 3 diffs the ledger against the *declaration* — so a
declaration of nothing is a declaration nothing can contradict. The
bare seal, which exists so idle turns are not nagged, is also the
escape hatch from every check that keys off the summary.

That is the founding incident's exact shape. The agent that forgets to
append is the agent that forgets to declare; asking it to declare, and
then trusting the declaration to be complete, moves the forgetting one
step earlier and calls the result verified.

The declaration is self-report and always will be. What makes it
checkable is that a turn which touched a repo leaves evidence
independent of what it says about itself: commits, with their own
timestamps, in clones the hook can read.

## What the fixture freezes

A clone that gained a commit during this turn, and a current summary
declaring nothing.

## Expected

Check 1 fires. Not check 3 — the ledger is not behind, the declaration
is.
