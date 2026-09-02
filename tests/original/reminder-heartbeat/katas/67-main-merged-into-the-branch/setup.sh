#!/usr/bin/env bash
# main was merged INTO the working branch to pick up a merged PR
# (measured 2026-08-16). The branch is committed and pushed, the tree
# is clean, signing is off — every other check is green, and only the
# shape of the history says anything went wrong.
set -eu
. ./_lib.sh
kata_repo skills clean
work="$PWD/repos/skills"
landed=2026-08-03T16:50:00Z
merged=2026-08-03T16:52:00Z
# The forge's default branch, holding a PR that merged there: a merge
# commit reachable from main is the forge's own and must stay legal.
git -C "$work" branch main
git -C "$work" checkout -q main
git -C "$work" checkout -q -b claude/earlier
echo "an earlier PR" >> "$work/earlier.txt"
git -C "$work" add -A
GIT_COMMITTER_DATE="$SEEDED" git -C "$work" commit -q --date "$SEEDED" -m "feat: an earlier PR"
git -C "$work" checkout -q main
GIT_COMMITTER_DATE="$landed" git -C "$work" merge -q --no-ff claude/earlier -m "Merge pull request #1"
git -C "$work" push -q origin main
git -C "$work" remote set-head origin main
# Back on the working branch: the turn merges main in "to pick up the
# merged PR", commits the merge, and pushes it.
git -C "$work" checkout -q claude/kata
echo "work done this turn" >> "$work/README.md"
git -C "$work" add -A
GIT_COMMITTER_DATE="$merged" git -C "$work" commit -q --date "$merged" -m "feat: work this turn"
GIT_COMMITTER_DATE="$merged" git -C "$work" merge -q --no-ff origin/main -m "chore: merge main"
git -C "$work" push -q origin claude/kata
