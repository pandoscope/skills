#!/usr/bin/env bash
# The store holds another conversation's log and nothing names this
# one: the identity the append guard demands is absent, while the
# turn declares a thread whose event therefore cannot be written.
set -eu
. ./_lib.sh
kata_repo session-memory clean
