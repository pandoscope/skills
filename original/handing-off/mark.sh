#!/usr/bin/env bash
# Write the freshness marker that hooks compare against.
#
# Usage: mark.sh <handoff-file> [published-url]
# Env:   HANDOFF_STATE      marker path (default ~/.claude/handoff-state.json)
#        HANDOFF_TRANSCRIPT transcript path; unset = newest *.jsonl under
#                           ~/.claude/projects (the live transcript is the
#                           most recently written one)
#
# The marker records the transcript's line count at handoff time. A hook
# judging freshness compares growth since then — age alone is wrong in
# both directions: an old handoff with nothing after it is still fresh,
# a recent one buried under a day of work is not. Without a findable
# transcript the marker carries null and hooks fall back to age.
set -euo pipefail

handoff=${1:?usage: mark.sh <handoff-file> [published-url]}
url=${2:-}
if [ ! -s "$handoff" ]; then
    echo "mark.sh: handoff file missing or empty: $handoff" >&2
    exit 1
fi

state=${HANDOFF_STATE:-$HOME/.claude/handoff-state.json}
transcript=${HANDOFF_TRANSCRIPT:-}
if [ -z "$transcript" ]; then
    transcript=$(find "$HOME/.claude/projects" -name '*.jsonl' -type f \
                     -printf '%T@ %p\n' 2>/dev/null \
                 | sort -rn | head -1 | cut -d' ' -f2-)
fi

lines=null
if [ -n "$transcript" ] && [ -f "$transcript" ]; then
    lines=$(wc -l < "$transcript")
else
    transcript=""
    echo "mark.sh: no transcript found — hooks fall back to marker age" >&2
fi

# printf, not a JSON tool: the consumer may lack one, and none of these
# values can contain a double quote (paths are ours, count is a number).
mkdir -p "$(dirname "$state")"
printf '{"written_at":"%s","handoff_path":"%s","published_url":"%s","transcript_path":"%s","transcript_lines":%s}\n' \
    "$(date -u +%FT%TZ)" "$handoff" "$url" "$transcript" "$lines" \
    > "$state"
echo "marker written: $state"
