#!/bin/bash
# The compaction gate (skills#170). The SYSTEM invokes the handoff,
# not the user: auto-compaction fires without the user acting, and
# handoffs have been missed by human oversight before — so a gate
# that blocks beats a reminder that trusts. Moved here from the
# installing project's hooks together with verify.sh: both read what
# mark.sh writes, so the whole contract ships and versions with the
# skill.
#
# Three hooks, one channel each, matched to what each channel can
# actually reach (verified against the hooks reference, meta#93):
#   - Stop, exit 2: stderr reaches the MODEL → the invocation channel
#     (the installing project's reminder hook, where present).
#   - PreCompact, exit 2 (this file): blocks manual AND auto
#     compaction, stderr reaches only the user → the last-resort gate,
#     never the invoker.
#   - SessionStart source=compact (verify.sh): stdout injected into
#     the fresh context → the post-compaction verification.
#
# Freshness is growth-based: the marker records the context size at
# handoff time (the token sum of the transcript's last assistant
# usage — the same measure compaction acts on), and the guard blocks
# once the context grew past the slack — age alone is wrong in both
# directions (an old handoff with nothing after it is still fresh, a
# recent one buried under heavy context growth since is not). Age is
# the fallback when no token measure exists on either side.
set -u
[ "${PRECOMPACT_GUARD:-on}" = "off" ] && exit 0
input=$(cat)
state="${HANDOFF_STATE:-$HOME/.claude/handoff-state.json}"
block() { echo "$1" >&2; exit 2; }
[ -f "$state" ] || block "COMPACTION BLOCKED: no handoff marker at \
$state. Have the session run the handing-off skill, then /compact \
again (PRECOMPACT_GUARD=off overrides)."
tokens_then=$(sed -n 's/.*"context_tokens":\([0-9]\{1,\}\).*/\1/p' "$state")
transcript=$(printf '%s' "$input" | jq -r '.transcript_path // empty' 2>/dev/null)
[ -f "${transcript:-/nonexistent}" ] \
    || transcript=$(sed -n 's/.*"transcript_path":"\([^"]*\)".*/\1/p' "$state")
tokens_now=""
if [ -n "$transcript" ] && [ -f "$transcript" ]; then
    tokens_now=$(jq -rs '[ .[] | select(.type? == "assistant") | .message.usage
                           | select(. != null) ] | last
                         | if . == null then empty
                           else (.input_tokens // 0)
                                + (.cache_read_input_tokens // 0)
                                + (.cache_creation_input_tokens // 0) end' \
                 "$transcript" 2>/dev/null) || tokens_now=""
fi
if [ -n "$tokens_then" ] && [ -n "$tokens_now" ]; then
    grown=$(( tokens_now - tokens_then ))
    slack="${HANDOFF_STALE_TOKENS:-50000}"
    [ "$grown" -le "$slack" ] || block "COMPACTION BLOCKED: the handoff \
marker is stale — the context grew ~$grown tokens (slack $slack) since \
it was written. Have the session rerun the handing-off skill, then \
/compact again (PRECOMPACT_GUARD=off overrides)."
else
    age=$(( $(date +%s) - $(date -r "$state" +%s) ))
    max="${HANDOFF_MAX_AGE:-3600}"
    [ "$age" -le "$max" ] || block "COMPACTION BLOCKED: the handoff \
marker is ${age}s old and carries no token measure to judge growth \
against. Have the session rerun the handing-off skill, then /compact \
again (PRECOMPACT_GUARD=off overrides)."
fi
exit 0
