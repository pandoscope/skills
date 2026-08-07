#!/usr/bin/env bash
# The review was read AND its outcome reached the decision store this
# turn — the observed write is what greens the check, not the words.
set -eu
. ./_lib.sh
kata_repo skills clean
kata_repo decision-memory committed-this-turn 2026-08-03T15:15:00Z
