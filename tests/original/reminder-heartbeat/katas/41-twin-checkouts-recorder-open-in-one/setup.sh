#!/usr/bin/env bash
# Two legitimate checkouts of one decision store; the recorder session
# is open in the workspace one, and this turn's record sits there.
set -eu
. ./_lib.sh
kata_repo skills marked-this-turn 2026-08-03T21:04:00Z
kata_decisions empty
kata_decisions_twin workspace open-recorded
