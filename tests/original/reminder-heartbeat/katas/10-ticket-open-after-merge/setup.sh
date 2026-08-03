#!/usr/bin/env bash
# Every built check is green; the drift is between the declared ticket
# and what the transcript shows was done to it.
set -eu
. ./_lib.sh
kata_repo session-memory clean
