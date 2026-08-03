#!/usr/bin/env bash
# Everything the built checks look at is in order; only the published
# artifact is behind, and nothing yet looks at that.
set -eu
. ./_lib.sh
kata_repo session-memory clean
touch -d "2026-08-02T17:40:06Z" store/LEDGER.md
