#!/usr/bin/env bash
# run-probe check: rung-1 checks, then the residue. Self-contained.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
fail() { printf '\n⚠️  **RUN-PROBE: %s**  ⚠️\n\n    %s\n    %s\n\n' "$1" "$2" "$3" >&2; exit 1; }

[ -f "$here/SKILL.md" ] || fail "SKILL.MD MISSING" "no SKILL.md beside check.sh" "restore it from the skills repo"
grep -q '^name: run-probe' "$here/SKILL.md" || fail "FRONTMATTER BROKEN" "name: run-probe absent" "fix the frontmatter"
grep -q 'take-probe skill with reference' "$here/SKILL.md" || fail "SPAWN LINE MISSING" "the fixed initial-prompt line is gone" "restore step 2's verbatim line"
tokens=$(( $(wc -c < "$here/SKILL.md") / 4 ))
[ "$tokens" -le 1000 ] || fail "OVER TOKEN BUDGET" "SKILL.md ~${tokens} tokens (ceiling 1000)" "prune per writing-skills"

echo "run-probe check: rung-1 OK (~${tokens} tokens)"
cat <<'RESIDUE'
Residue (agent-verified, no script can):
- observed session got ONLY the fixed one-liner, nothing else
- verdict reported verbatim; recorded on ticket and ledger
RESIDUE
