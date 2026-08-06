#!/usr/bin/env bash
# The term lives in a gitignored file inside the clone and in the
# environment itself — nowhere outgoing. The check must not fire on
# where a term LIVES, only on where it would LEAVE.
set -eu
. ./_lib.sh
kata_repo skills clean
echo ".env.local" > repos/skills/.gitignore
git -C repos/skills add .gitignore
GIT_COMMITTER_DATE="$SEEDED" git -C repos/skills commit -q \
    --date "$SEEDED" -m "chore: ignore local env"
git -C repos/skills push -q origin claude/kata
echo "hunter2" > repos/skills/.env.local
