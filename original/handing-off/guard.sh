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
# shellcheck source=original/handing-off/state.sh
. "$(dirname "${BASH_SOURCE[0]}")/state.sh"
state=$(handoff_marker_to_read "$(handoff_session_of_hook_input "$input")")
block() { echo "$1" >&2; exit 2; }
if ! handoff_has_marker "$state"; then
    where=${state:-"(the hook input names no session)"}
    block "COMPACTION BLOCKED: no handoff marker for this session at \
$where. Have the session run the handing-off skill, then /compact \
again (PRECOMPACT_GUARD=off overrides)."
fi
# DECISION:SCOPE — While the runs are under way the handoff is not
# done, whatever the marker says: the principal moved this check from
# slice B into skills#267.
phase=$(handoff_json_field phase "$(cat "$state")")
case "$phase" in
    listed|written)
        block "COMPACTION BLOCKED: the handing-off runs are in the phase \
$phase, so the handoff is not complete. Have the session finish the \
handing-off skill, then /compact again (PRECOMPACT_GUARD=off overrides)." ;;
esac
transcript=$(handoff_json_field transcript_path "$input")
[ -f "${transcript:-/nonexistent}" ] \
    || transcript=$(handoff_json_field transcript_path "$(cat "$state")")
if ! stale=$(handoff_marker_staleness "$state" "$transcript"); then
    block "COMPACTION BLOCKED: the handoff marker $stale. Have the session \
rerun the handing-off skill, then /compact again (PRECOMPACT_GUARD=off \
overrides)."
fi
exit 0
