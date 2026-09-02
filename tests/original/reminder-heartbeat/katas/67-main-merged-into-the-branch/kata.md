# main merged into the working branch

Measured 2026-08-16: to pick up a PR that had just merged, main was
merged INTO the working branch. The merge succeeded, the tree was
clean, the push went through — and the branch's rebase range now held
45 upstream commits, so the history repair that followed took four
steps (abort, rebuild from origin/main, cherry-pick, force-with-lease).

The rule (skills#147): a working branch is updated by rebase onto
origin/main, never by merging anything into it. The only legitimate
merge commits are the ones a forge makes when it merges a PR.

## What the fixture freezes

A clone on `claude/kata` carrying a merge commit whose second parent
is `origin/main`. main itself holds a forge-style merge commit from an
earlier PR — reachable from main, so not the branch's — and the
working branch is committed and pushed: every other check is green.

## Expected

Check 17 fires, naming the clone, the merge commit by its subject, and
the rebase.

The judgement is the branch's own range — merge commits reachable
from the tip and NOT from origin/main — so the forge's merge on main
does not fire it, and neither would a linear branch rebased on top of
that merge.
