#!/usr/bin/env bash
# Write the freshness marker that hooks compare against.
#
# Usage: mark.sh <handoff-file> [published-url]
# Env:   HANDOFF_STATE      marker path (default ~/.claude/handoff-state.json)
#        HANDOFF_TRANSCRIPT transcript path; unset = newest *.jsonl under
#                           ~/.claude/projects (the live transcript is the
#                           most recently written one)
#
# The marker records the context size at handoff time: the token sum
# (prompt + cache reads + cache writes) of the transcript's last
# assistant usage — the same measure compaction itself acts on. A hook
# judging freshness compares growth since then; age alone is wrong in
# both directions — an old handoff with nothing after it is still
# fresh, a recent one buried under heavy context growth since is not.
# Without a findable transcript (or one carrying no usage yet) the
# marker carries null and hooks fall back to age.
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

# sed, not a JSON tool: the consumer may lack one. The quoted key
# "input_tokens": cannot match inside "cache_read_input_tokens" — the
# opening quote only ever precedes the full key.
tokens=null
usage_line=""
if [ -n "$transcript" ] && [ -f "$transcript" ]; then
    usage_line=$(grep '"usage"' "$transcript" | tail -1 || true)
else
    transcript=""
fi
if [ -n "$usage_line" ]; then
    in=$(printf '%s' "$usage_line" | sed -n 's/.*"input_tokens":\([0-9]\{1,\}\).*/\1/p')
    cr=$(printf '%s' "$usage_line" | sed -n 's/.*"cache_read_input_tokens":\([0-9]\{1,\}\).*/\1/p')
    cc=$(printf '%s' "$usage_line" | sed -n 's/.*"cache_creation_input_tokens":\([0-9]\{1,\}\).*/\1/p')
    tokens=$(( ${in:-0} + ${cr:-0} + ${cc:-0} ))
else
    echo "mark.sh: no transcript usage found — hooks fall back to marker age" >&2
fi

mkdir -p "$(dirname "$state")"
printf '{"written_at":"%s","handoff_path":"%s","published_url":"%s","transcript_path":"%s","context_tokens":%s}\n' \
    "$(date -u +%FT%TZ)" "$handoff" "$url" "$transcript" "$tokens" \
    > "$state"
echo "marker written: $state"
