#!/usr/bin/env bash
# The page was rendered after the last real event and BEFORE the seal
# that closed that turn — the state every healthy turn leaves behind.
set -eu
. ./_lib.sh
kata_repo session-memory clean
mkdir -p artifact
printf '<title>Thread ledger</title>\n' > artifact/ledger.html
touch -d "2026-08-02T18:20:30Z" artifact/ledger.html
