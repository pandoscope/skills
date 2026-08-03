#!/usr/bin/env bash
# The turn's edits never left the working tree.
set -eu
. ./_lib.sh
kata_repo skills dirty
