#!/usr/bin/env bash
# The turn fetched a review thread whose comment carries no
# attribution footer — a human wrote it — and then declared
# `reviews: none`. The contradiction is store-independent.
set -eu
. ./_lib.sh
kata_repo skills clean
