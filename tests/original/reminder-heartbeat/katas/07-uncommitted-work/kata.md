# Work left in the working tree

The other half of check 2, and the more dangerous half. This container
is ephemeral: the repos were cloned when it started and it is reclaimed
after a period of inactivity. An unpushed commit survives until then; an
uncommitted edit does not survive at all.

`git status` and `HEAD` against origin answer different questions, and
a check that asked only the second would call this turn clean.

## What the fixture freezes

A turn whose ledger event landed and whose summary is current, with a
clone whose working tree carries edits that were never committed.

## Expected

Check 2 fires, naming the clone and the commit-and-push that would
clear it. Uncommitted is reported before unpushed, because a change
that is not committed cannot be pushed.
