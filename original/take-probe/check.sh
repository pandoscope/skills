#!/usr/bin/env bash
# take-probe check: rung-1 checks, then the residue. Self-contained.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
fail() { printf '\n⚠️  **TAKE-PROBE: %s**  ⚠️\n\n    %s\n    %s\n\n' "$1" "$2" "$3" >&2; exit 1; }

[ -f "$here/SKILL.md" ] || fail "SKILL.MD MISSING" "no SKILL.md beside check.sh" "restore it from the skills repo"
grep -q '^name: take-probe' "$here/SKILL.md" || fail "FRONTMATTER BROKEN" "name: take-probe absent" "fix the frontmatter"
tokens=$(( $(wc -c < "$here/SKILL.md") / 4 ))
[ "$tokens" -le 1000 ] || fail "OVER TOKEN BUDGET" "SKILL.md ~${tokens} tokens (ceiling 1000)" "prune per writing-skills"

echo "take-probe check: rung-1 OK (~${tokens} tokens)"
cat <<'RESIDUE'
Residue (agent-verified, no script can):
- probe.md was read from the referenced dir and followed verbatim
- the final message is the report the fixture asked for
RESIDUE
