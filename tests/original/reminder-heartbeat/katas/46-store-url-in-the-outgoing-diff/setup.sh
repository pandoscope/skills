#!/usr/bin/env bash
# A commit that has not left yet carries the decision store's URL — the
# value of DECISION_MEMORY_URL — in its diff. Everything else is clean,
# so the only thing standing between the value and origin is this check.
set -eu
. ./_lib.sh
kata_decisions empty
kata_repo skills clean
echo "store: $PWD/.origins/decision-memory.git" >> repos/skills/README.md
git -C repos/skills add -A
GIT_COMMITTER_DATE="$SEEDED" git -C repos/skills commit -q \
    --date "$SEEDED" -m "docs: note the store location"
