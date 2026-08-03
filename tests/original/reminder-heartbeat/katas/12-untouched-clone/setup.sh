#!/usr/bin/env bash
# A clone the session never opened, on a branch that was never pushed.
set -eu
. ./_lib.sh
kata_repo ghx untouched
