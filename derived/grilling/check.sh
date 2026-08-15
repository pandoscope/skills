#!/usr/bin/env bash
# Grilling session check — the completion-criterion ladder, mechanized.
# Rung 1 runs here: the session JSON validates, both user-facing forms
# render, every cited preference is a verbatim store line, and the
# store carries no unmerged records. Everything below rung 1 prints as
# the named residue.
# Self-contained: needs only this folder and node (which the renderer
# itself already requires).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
session="${1:-}"
if [ -z "$session" ] || [ ! -f "$session" ]; then
    echo "usage: check.sh <session.json>" >&2
    exit 2
fi

out="$(mktemp -d)"
trap 'rm -rf "$out"' EXIT
fail=0
err() { echo "FAIL: $*" >&2; fail=1; }

node --experimental-strip-types --disable-warning=ExperimentalWarning \
    "$HERE/render/render.ts" "$session" --out "$out"
if [ ! -s "$out/session.html" ] || [ ! -s "$out/session.md" ]; then
    echo "check: renderer produced empty output" >&2
    exit 1
fi
echo "check: session JSON valid; session.html and session.md rendered."

# Store-backed checks. An unnamed or unresolved store means recording is
# skipped this session — said out loud here rather than failing, since
# the skip is legitimate and its announcement is the residue.
if store=$("$HERE/resolve-store.sh" path 2>/dev/null); then
    prefs="$store/preferences.txt"
    if [ -f "$prefs" ]; then
        # Citations must be store lines verbatim: the extraction tally
        # matches by line, so a paraphrase silently scores nothing.
        while IFS= read -r cited; do
            [ -n "$cited" ] || continue
            grep -Fxq "$cited" "$prefs" \
                || err "cited preference is not a verbatim line of preferences.txt: $cited"
        done < <(node -e '
            const s = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
            for (const p of s.preferences ?? []) console.log(p);
        ' "$session")
    else
        echo "check: $prefs absent — citations not verified against the store."
    fi

    # One session at a time: records the principal has not reviewed and
    # merged must not be overtaken by a second session's.
    unmerged=$("$HERE/resolve-store.sh" unmerged || true)
    if [ -n "$unmerged" ]; then
        err "decision records are recorded but not merged — the principal reviews and merges before this session counts as finished, and before another grilling session opens:
$unmerged"
    fi
else
    echo "check: no decision store resolved — recording is skipped this session, and the skip belongs in the reply out loud."
fi

[ "$fail" -eq 0 ] || exit 1

cat <<'RESIDUE'
residue (verify yourself, hand the rest to the human):
- artifact republished at the session's URL, or session.md printed into chat verbatim
- rejection reasons embedded in the session's target artifact
- session PR states hit rates in two streams: preference-driven vs cold
RESIDUE
