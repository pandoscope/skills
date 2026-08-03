#!/usr/bin/env bash
# The turn's work is committed and pushed; only the declaration is stale.
set -eu
. ./_lib.sh
kata_repo session-memory clean
