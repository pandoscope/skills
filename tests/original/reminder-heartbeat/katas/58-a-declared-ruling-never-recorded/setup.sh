#!/usr/bin/env bash
# The summary declares a ruling; the decision store's corpus gained
# nothing this turn. The declared set is the model's own report — the
# grammar the check diffs against observed files.
set -eu
. ./_lib.sh
kata_repo skills clean
kata_decisions empty
