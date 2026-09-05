#!/usr/bin/env bash
# The turn committed to a clone on a branch outside the ticket pattern,
# in a repo that carries the pattern; everything else is clean.
set -eu
. ./_lib.sh
kata_repo skills committed-this-turn 2026-08-03T15:15:00Z
work="$PWD/repos/skills"
mkdir -p "$work/.github"
cat > "$work/.github/reference-keywords.json" <<'JSON'
{
  "allowed": { "CLOSES": "closing", "FIXES": "closing", "ADVANCES": "non-closing" },
  "github_native": ["close", "closes", "closed", "fix", "fixes", "fixed", "resolve", "resolves", "resolved"],
  "branch_pattern": "claude/((?:[a-z][a-z0-9]*?)?\\d+(?:-(?:[a-z][a-z0-9]*?)?\\d+)*)-"
}
JSON
git -C "$work" add -A
GIT_COMMITTER_DATE=2026-08-03T15:15:30Z git -C "$work" commit -q --date 2026-08-03T15:15:30Z -m "chore: carry the keyword list"
git -C "$work" push -q origin claude/kata
