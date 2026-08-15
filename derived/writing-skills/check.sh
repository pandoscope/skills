#!/usr/bin/env bash
# The rung-1 half of writing-skills' completion criteria, run against
# the skill being authored or reviewed. Mechanical failures exit
# non-zero naming what is wrong; everything below rung 1 prints as the
# residue, so the unchecked half is named rather than remembered.
set -euo pipefail

skill_dir=${1:?usage: check.sh <skill-folder>}
md="$skill_dir/SKILL.md"
fail=0
err() { echo "FAIL: $*" >&2; fail=1; }

[ -f "$md" ] || { echo "FAIL: $md does not exist" >&2; exit 1; }

grep -q '^name:' "$md" || err "frontmatter carries no name:"
grep -q '^description' "$md" || err "frontmatter carries no description"

# Self-containment, the mechanical slice: every relative markdown link
# in SKILL.md resolves inside the folder.
while IFS= read -r target; do
    target=${target%%#*}
    [ -n "$target" ] || continue
    case "$target" in
        http://*|https://*) ;;              # external references are allowed
        /*) err "link leaves the folder: $target" ;;
        *) [ -f "$skill_dir/$target" ] || err "dangling link: $target" ;;
    esac
done < <(grep -o ']([^)]*\.md[^)]*)' "$md" | sed 's/^](//; s/)$//')

# The skill under work carries its own wired check.
chk=$(find "$skill_dir" -maxdepth 1 -name 'check.*' -type f | head -1)
if [ -z "$chk" ]; then
    err "no check script beside SKILL.md"
else
    [ -x "$chk" ] || err "$(basename "$chk") is not executable"
    grep -q "$(basename "$chk")" "$md" \
        || err "SKILL.md never runs $(basename "$chk")"
fi

[ "$fail" -eq 0 ] || exit 1
echo "mechanical checks pass: $skill_dir"
cat <<'RESIDUE'
Residue — verify by reading, or hand to the human:
- baseline test ran without the skill; harness and model recorded
- description is triggers only, one per branch, leading word first
- each step ends on the highest rung its criterion can reach
- no-op hunt done sentence by sentence
RESIDUE
