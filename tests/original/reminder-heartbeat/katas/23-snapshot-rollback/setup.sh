#!/usr/bin/env bash
# The whole .git is snapshotted before the pushes and restored after —
# remote-tracking refs included, exactly as a container restore does.
set -eu
. ./_lib.sh
kata_repo skills clean
W=repos/skills
cp -r "$W/.git" .git-snapshot
for i in 1 2 3; do
    echo "c$i" >> "$W/README.md"
    GIT_COMMITTER_DATE="$SEEDED" git -C "$W" commit -q --date "$SEEDED" -am "feat: c$i"
done
git -C "$W" push -q origin claude/kata
rm -rf "$W/.git"
cp -r .git-snapshot "$W/.git"
git -C "$W" checkout -q -- .
