#!/usr/bin/env bash
# One commit, pushed, no ledger event, and a render older than the log.
set -eu
. ./_lib.sh
kata_repo session-memory committed-this-turn 2026-09-04T10:05:00Z
mkdir -p artifact
printf '<title>Thread ledger</title>\n' > artifact/ledger.html
touch -d "2026-09-04T09:20:00Z" artifact/ledger.html
