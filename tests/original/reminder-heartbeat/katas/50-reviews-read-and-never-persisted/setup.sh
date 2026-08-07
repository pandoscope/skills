#!/usr/bin/env bash
# The review was read — the summary says so — and no memory gained a
# word of it. The answers live only in a transcript the container
# discards.
set -eu
. ./_lib.sh
kata_repo skills clean
kata_repo decision-memory clean
