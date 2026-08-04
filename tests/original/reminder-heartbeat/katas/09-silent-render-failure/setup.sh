#!/usr/bin/env bash
# Every built check is green; only the rendered page is behind the
# newest event, and until check 5 nothing looked at that.
set -eu
. ./_lib.sh
kata_repo session-memory clean
mkdir -p artifact
printf '<title>Thread ledger</title>\n' > artifact/ledger.html
touch -d "2026-08-02T17:40:06Z" artifact/ledger.html
