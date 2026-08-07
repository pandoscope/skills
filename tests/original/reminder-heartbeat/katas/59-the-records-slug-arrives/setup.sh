#!/usr/bin/env bash
# The declared slug is in a decisions/ filename that arrived this
# turn — the observed write is the green, the declaration only scoped it.
set -eu
. ./_lib.sh
kata_repo skills clean
kata_decisions recorded 2026-08-03T15:16:00Z
