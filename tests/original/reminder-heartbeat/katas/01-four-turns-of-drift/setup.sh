#!/usr/bin/env bash
# The turn committed and pushed real work — so the drift is the ledger's
# alone, exactly as in the incident.
set -eu
. ./_lib.sh
kata_repo session-memory clean
