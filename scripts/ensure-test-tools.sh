#!/usr/bin/env bash
# SessionStart bootstrap: make `make test` and `make lint` runnable.
#
# The suite for derived/tdd/lint-red.sh needs bats, and `make lint` needs the
# shell linter; neither ships in a fresh remote agent container, so guard-script
# changes would otherwise be pushed untested (see #16 for what that cost).
# Best-effort and quiet: a failed bootstrap must never block a session.
set -u

if ! command -v bats >/dev/null 2>&1; then
    if command -v npm >/dev/null 2>&1; then
        npm install -g bats >/dev/null 2>&1 || true
    fi
fi

if ! command -v shellcheck >/dev/null 2>&1; then
    if command -v apt-get >/dev/null 2>&1; then
        apt-get install -y -q shellcheck >/dev/null 2>&1 \
            || sudo apt-get install -y -q shellcheck >/dev/null 2>&1 || true
    elif command -v brew >/dev/null 2>&1; then
        brew install shellcheck >/dev/null 2>&1 || true
    fi
fi

missing=()
command -v bats >/dev/null 2>&1 || missing+=(bats)
command -v shellcheck >/dev/null 2>&1 || missing+=(shellcheck)

if [[ ${#missing[@]} -gt 0 ]]; then
    echo "ensure-test-tools: missing ${missing[*]} — 'make test'/'make lint' will not run here." >&2
fi
