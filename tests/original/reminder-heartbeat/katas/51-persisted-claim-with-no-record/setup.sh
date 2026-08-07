#!/usr/bin/env bash
# The summary claims the review outcome was persisted. The store's
# checkout shows nothing this turn — the claim is exactly the kind of
# self-report the founding ruling says cannot green a check.
set -eu
. ./_lib.sh
kata_repo skills clean
kata_repo decision-memory clean
