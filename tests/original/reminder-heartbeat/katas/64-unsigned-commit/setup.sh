#!/usr/bin/env bash
# Signing is configured, and the turn's commit carries no signature.
# Dates are fixed so the commit lands inside the turn window and its
# hash is reproducible — the reason text names it, and a fixture whose
# hash moved would make the contract untestable.
set -eu
. ./_lib.sh
kata_repo skills clean
work="$PWD/repos/skills"
made=2026-08-03T17:00:00Z
git -C "$work" config --local commit.gpgsign true
echo "work done this turn" >> "$work/README.md"
git -C "$work" add -A
GIT_COMMITTER_DATE="$made" git -C "$work" commit -q --no-gpg-sign \
    --date "$made" -m "feat: work this turn"
git -C "$work" push -q origin claude/kata
