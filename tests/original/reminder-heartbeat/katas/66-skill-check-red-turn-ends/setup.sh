#!/usr/bin/env bash
# A turn edits a skill whose own check fails, and nothing blocks it.
# Dates are fixed so the commit lands inside the turn window.
set -eu
. ./_lib.sh
kata_repo skills clean
work="$PWD/repos/skills"
made=2026-08-03T17:00:00Z
mkdir -p "$work/derived/example-skill"
cat > "$work/derived/example-skill/SKILL.md" <<'MD'
---
name: example-skill
description: A fixture skill whose own check fails.
---
MD
cat > "$work/derived/example-skill/check.sh" <<'CHECK'
#!/bin/sh
echo "FAIL: SKILL.md is over its token budget" >&2
exit 1
CHECK
chmod +x "$work/derived/example-skill/check.sh"
git -C "$work" add -A
GIT_COMMITTER_DATE="$made" git -C "$work" commit -q --date "$made" \
    -m "feat: edit a skill this turn"
git -C "$work" push -q origin claude/kata
