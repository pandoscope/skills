#!/usr/bin/env bash
# Measured 2026-09-04 by probe spawn-r1b1 (skills#185): the harness
# creates the session branch at the fresh tip of main, while the
# clone's origin/main tracking ref is older. The branch's tip is the
# forge's own merge — it IS main on the remote — and nothing this
# turn touched the clone.
set -eu
. ./_lib.sh
kata_repo disambiguate clean
work="$PWD/repos/disambiguate"
landed=2026-08-03T16:50:00Z
git -C "$work" branch main
git -C "$work" checkout -q main
seed=$(git -C "$work" rev-parse HEAD)
git -C "$work" checkout -q -b claude/earlier
echo "an earlier PR" >> "$work/earlier.txt"
git -C "$work" add -A
GIT_COMMITTER_DATE="$SEEDED" git -C "$work" commit -q --date "$SEEDED" -m "feat: an earlier PR"
git -C "$work" checkout -q main
GIT_COMMITTER_DATE="$landed" git -C "$work" merge -q --no-ff claude/earlier -m "chore: update agentic template to v4.11.1 (#82)"
git -C "$work" push -q origin main
# The session branch, created at main's tip — then the tracking ref
# falls behind, as a clone nobody fetched does.
git -C "$work" checkout -q -b claude/focused-kata main
git -C "$work" push -q -u origin claude/focused-kata
git -C "$work" update-ref refs/remotes/origin/main "$seed"
# The turn then works on that branch, so the untouched-clone path does
# not apply: only refreshing the base can clear the forge's merge.
echo "work done this turn" >> "$work/README.md"
git -C "$work" add -A
GIT_COMMITTER_DATE="2026-08-03T16:52:00Z" git -C "$work" commit -q --date "2026-08-03T16:52:00Z" -m "feat: work this turn"
git -C "$work" push -q origin claude/focused-kata
git -C "$work" update-ref refs/remotes/origin/main "$seed"
