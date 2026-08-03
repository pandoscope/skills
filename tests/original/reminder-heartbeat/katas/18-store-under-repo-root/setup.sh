#!/usr/bin/env bash
# The store lives among the session's clones, and carries an uncommitted
# change of exactly the kind the hook's own seal produces.
set -eu
. ./_lib.sh
kata_repo skills clean
mv store repos/session-memory
git init -q -b main repos/session-memory
git -C repos/session-memory config user.email kata@example.test
git -C repos/session-memory config user.name kata
git -C repos/session-memory add -A
GIT_COMMITTER_DATE=2020-01-01T00:00:00Z git -C repos/session-memory commit -q \
    --date 2020-01-01T00:00:00Z -m "chore: seed"
echo '{"ev":"sealed","at":"2026-08-03T22:59:00+00:00"}' \
    >> repos/session-memory/ledger/session_kata_store.jsonl
