# shellcheck shell=bash
# The store that keeps a run's state across a resume (skills#267).
# Sourced by the scripts that push or restore it, after state.sh.
#
# A resume into a new container loses every file under the home
# directory, every untracked file and every unpushed commit
# (skills#268, question 7). The handoff draft and the per-session state
# are therefore pushed to a git store at the end of each run; the local
# copies are a cache. The store is available when a push to it
# succeeds: a set variable proves nothing.
#
# In the store, a session's files sit under handoffs/sessions/<session-id>/
# as draft.md and state.json.
# DECISION:SCOPE — Layout and HANDOFF_STORE are the principal's choice;
# skills#267 asked only that both paths carry the session id and that a
# project without a session-memory store can name its own place. The pushed state names the draft by that
# path, never by a URL of the store: a store URL is a blocked term of
# the outgoing scan.

# The lookup of the store's clone and its branch lives in
# store-lookup.sh, sourced here.
# shellcheck source=original/handing-off/store-lookup.sh
. "$(dirname "${BASH_SOURCE[0]}")/store-lookup.sh"

# Print a session's directory in the store, relative to its root.
#   $1  session id
handoff_store_dir() {
    printf 'handoffs/sessions/%s\n' "$1"
}

# Print text with the values of the store URL variables, and the URL
# of the clone's origin, replaced by their names, so a git error can be
# forwarded without a store URL.
#   $1  text
#   $2  the store's root; optional
handoff_store_redact() {
    local text=$1 name origin=""
    for name in SESSION_MEMORY_URL DECISION_MEMORY_URL EVIDENCE_MEMORY_URL; do
        if [ -n "${!name:-}" ]; then
            text=${text//"${!name}"/\$$name}
        fi
    done
    [ -z "${2:-}" ] || origin=$(git -C "$2" remote get-url origin 2>/dev/null || true)
    if [ -n "$origin" ]; then
        text=${text//"$origin"/<store origin>}
    fi
    printf '%s\n' "$text"
}

# Write a session's state, and its draft when given, in the form the
# store gets them.
#   $1  session id
#   $2  the local state file
#   $3  the local draft; may be empty
#   $4  the directory to write state.json and draft.md into
#   $5  the store's root; may be empty
# The rendered state names the draft, and the handoff of a marker, by
# the draft's path in the store, and drops transcript_path: a local
# absolute path means nothing to the container that restores it, and a
# blocklisted word in a directory name would fail every scan.
handoff_store_render() {
    local session=$1 state=$2 draft=$3 out=$4 root=$5 stored="" handoff=""
    local dir
    dir=$(handoff_store_dir "$session")
    cp "$state" "$out/state.json"
    if [ -n "$draft" ]; then
        cp "$draft" "$out/draft.md"
    fi
    if [ -n "$draft" ] || { [ -n "$root" ] && [ -f "$root/$dir/draft.md" ]; }; then
        stored="$dir/draft.md"
    fi
    if [ -n "$(handoff_json_field handoff_path "$(cat "$state")")" ]; then
        handoff=$stored
    fi
    handoff_state_set "$out/state.json" draft_path "$stored" \
        handoff_path "$handoff" transcript_path ""
}

# Scan a session's state, and its draft when given, in the form the
# store would get them (handoff_store_render).
#   $1  session id
#   $2  the local state file
#   $3  the local draft; may be empty
# Returns 0 when the outgoing scan passes; 2 on a hit, with scan.sh's
# report, which names each hit by its source, on stderr.
handoff_store_scan() {
    local session=$1 state=$2 draft=${3:-} tmp report status=0
    tmp=$(mktemp -d)
    handoff_store_render "$session" "$state" "$draft" "$tmp" "$(handoff_store_root)"
    report=$("$(dirname "${BASH_SOURCE[0]}")/scan.sh" "$tmp/state.json" \
                 ${draft:+"$tmp/draft.md"} 2>&1) || status=2
    rm -rf "$tmp"
    if [ "$status" -ne 0 ]; then
        printf '%s\n' "$report" | sed "s|$tmp/||g" >&2
    fi
    return "$status"
}

# Push a session's state, and its draft when given, to the store.
#   $1  session id
#   $2  the local state file
#   $3  the local draft; optional
# Every push goes through the outgoing scan first (handoff_store_scan),
# so no caller can push past it.
# Returns 0 once origin holds the files; 2 when the scan finds a
# blocked term, with nothing written to the store; 1 with the reason on
# stderr when no store took them: no clone, no session id, a detached
# HEAD, or a commit or push that failed after three attempts. Git's own
# error is forwarded with the store URLs replaced by their names.
handoff_store_push() {
    local session=$1 state=$2 draft=${3:-} root dir branch out attempt tmp pulled
    root=$(handoff_store_root)
    if [ -z "$root" ]; then
        echo "handing-off: no store clone: HANDOFF_STORE names none, and no" \
             "session-memory clone was found for SESSION_MEMORY_URL" >&2
        return 1
    fi
    if ! handoff_valid_session "$session"; then
        echo "handing-off: no session id to file the state under in $root" >&2
        return 1
    fi
    handoff_store_scan "$session" "$state" "$draft" || return 2
    branch=$(handoff_store_branch "$root")
    [ -n "$branch" ] || return 1
    dir=$(handoff_store_dir "$session")
    mkdir -p "$root/$dir"
    tmp=$(mktemp -d)
    handoff_store_render "$session" "$state" "$draft" "$tmp" "$root"
    cp "$tmp/state.json" "$root/$dir/state.json"
    [ -z "$draft" ] || cp "$tmp/draft.md" "$root/$dir/draft.md"
    rm -rf "$tmp"
    if ! out=$(git -C "$root" add -- "$dir" 2>&1); then
        echo "handing-off: git add in $root failed: $(handoff_store_redact "$out" "$root")" >&2
        return 1
    fi
    if ! git -C "$root" diff --cached --quiet -- "$dir"; then
        if ! out=$(git -C "$root" -c user.name=handing-off -c user.email=noreply@anthropic.com \
                       commit -q -m "handoff: $session $(handoff_json_field phase "$(cat "$state")")" \
                       -- "$dir" 2>&1); then
            # Nothing stays staged: the ledger's next commit would sweep
            # it in.
            git -C "$root" reset -q -- "$dir" 2>/dev/null || true
            echo "handing-off: commit in $root failed: $(handoff_store_redact "$out" "$root")" >&2
            return 1
        fi
    fi
    for attempt in 1 2 3; do
        if out=$(git -C "$root" push -q origin "HEAD:refs/heads/$branch" 2>&1); then
            return 0
        fi
        # A rejected push is mostly another writer's commit: rebase onto
        # it and try again. The rebase commits, so it needs the identity
        # the commit above used; a rebase that stops is aborted, so the
        # clone never stays mid-rebase.
        if ! pulled=$(git -C "$root" -c user.name=handing-off -c user.email=noreply@anthropic.com \
                          pull -q --rebase --autostash origin "$branch" 2>&1); then
            git -C "$root" rebase --abort > /dev/null 2>&1 || true
            out="$out; the rebase onto origin failed: $pulled"
        fi
    done
    echo "handing-off: push from $root to $branch failed after $attempt attempts:" \
         "$(handoff_store_redact "$out" "$root")" >&2
    return 1
}

# Restore a session's pushed state, and its draft, from the store.
#   $1  session id
#   $2  the local state file to write
#   $3  the local draft to write
# Returns 0 once the state is restored, with draft_path naming the
# local draft when the store held one; 1 when the store holds no state
# for the session; 2, with the reason on stderr, when no store is
# configured; 3, with the reason on stderr, when the store's clone is
# off its default branch or its remote does not answer.
# The restored marker keeps its token count: the transcript keeps its
# file name across a resume, so the guard's growth rule still measures
# against it.
handoff_store_pull() {
    local session=$1 state=$2 draft=$3 root branch dir out text
    root=$(handoff_store_root)
    if [ -z "$root" ]; then
        echo "handing-off: no store clone to restore from" >&2
        return 2
    fi
    handoff_valid_session "$session" || return 1
    branch=$(handoff_store_branch "$root")
    [ -n "$branch" ] || return 3
    if ! out=$(git -C "$root" fetch -q origin "$branch" 2>&1); then
        echo "handing-off: fetch in $root failed: $(handoff_store_redact "$out" "$root")" >&2
        return 3
    fi
    dir=$(handoff_store_dir "$session")
    text=$(git -C "$root" show "FETCH_HEAD:$dir/state.json" 2>/dev/null) || return 1
    mkdir -p "$(dirname "$state")" "$(dirname "$draft")"
    printf '%s\n' "$text" > "$state.tmp.$$"
    mv -f "$state.tmp.$$" "$state"
    if git -C "$root" show "FETCH_HEAD:$dir/draft.md" > "$draft.tmp.$$" 2>/dev/null; then
        mv -f "$draft.tmp.$$" "$draft"
        handoff_state_set "$state" draft_path "$draft"
        # The store names the marker's handoff by the draft's store path.
        if [ -n "$(handoff_json_field handoff_path "$text")" ]; then
            handoff_state_set "$state" handoff_path "$draft"
        fi
    else
        rm -f "$draft.tmp.$$"
        handoff_state_set "$state" draft_path ""
    fi
}
