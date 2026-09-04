# The merge nobody made this turn

**Ruling:** D2 on [skills#185](https://github.com/pandoscope/skills/issues/185).
Kata 67's shape — main merged into the working branch — but the
merge landed in an earlier turn and this turn never committed to the
clone. The debt is reported in the verdict's detail; the rebase
command is offered only to a turn that worked on the branch, because
rewriting a branch this turn did not touch is not this turn's to do.

## What the fixture freezes

A `claude/*` branch carrying a merge of main dated before the turn,
committed and pushed, clean tree, nothing committed this turn.

## Expected

`linear-history` passes with the merge named in its detail. The turn
seals.
