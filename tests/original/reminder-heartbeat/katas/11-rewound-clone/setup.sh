#!/usr/bin/env bash
# The clone came back behind a branch it had already pushed.
set -eu
. ./_lib.sh
kata_repo skills behind
