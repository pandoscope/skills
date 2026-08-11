#!/usr/bin/env bash
# A clone carrying a local git identity, as the harness writes when it
# attaches a repo mid-session.
set -eu
. ./_lib.sh
kata_repo skills clean
git -C "$PWD/repos/skills" config --local user.email noreply@anthropic.com
