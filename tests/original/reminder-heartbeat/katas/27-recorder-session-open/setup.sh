#!/usr/bin/env bash
# A recorder session is already open in the decision store checkout.
set -eu
. ./_lib.sh
kata_repo skills marked-this-turn 2026-08-03T21:04:00Z
kata_decisions empty
printf '%s\n' '{"branch":"session/20260803T203000Z","session":"kata"}' \
    > repos/decision-memory/.recorder-session.json
printf '%s\n' '.recorder-session.json' \
    >> repos/decision-memory/.git/info/exclude
