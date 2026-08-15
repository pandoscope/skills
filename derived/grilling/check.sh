#!/usr/bin/env bash
# Grilling session check — the completion-criterion ladder, mechanized.
# Rung 1 runs here: the session JSON validates and both user-facing
# forms render. Everything below rung 1 prints as the named residue.
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

node --experimental-strip-types --disable-warning=ExperimentalWarning \
    "$HERE/render/render.ts" "$session" --out "$out"
if [ ! -s "$out/session.html" ] || [ ! -s "$out/session.md" ]; then
    echo "check: renderer produced empty output" >&2
    exit 1
fi
echo "check: session JSON valid; session.html and session.md rendered."

cat <<'RESIDUE'
residue (verify yourself, hand the rest to the human):
- artifact republished at the session's URL, or session.md printed into chat verbatim
- every ruling recorded to decision-memory — or the skip said out loud
- rejection reasons embedded in the session's target artifact
- session PR states hit rates in two streams: preference-driven vs cold
RESIDUE
