#!/usr/bin/env bash
# A comment carrying the agent's attribution footer arrived from an
# account that is NOT a configured agent account. With accounts
# configured, that is a broken contract, not a classification input.
set -eu
. ./_lib.sh
kata_repo skills clean
