#!/usr/bin/env bash
# Two checkouts, recorder open in the workspace one, and no record
# anywhere: the block's command must come from the open checkout.
set -eu
. ./_lib.sh
kata_repo skills marked-this-turn 2026-08-03T21:04:00Z
kata_decisions empty
kata_decisions_twin workspace open
