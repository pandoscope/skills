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

# Print the directory of the store's clone.
# The first of these that holds a git clone wins:
#   1. HANDOFF_STORE, the place an installing project names for its
#      session artifacts
#   2. with SESSION_MEMORY_URL set: SESSION_MEMORY_ROOT, then the
#      harness's clone (SESSION_ROOT in ~/.claude/session.env joined
#      with the store repository's name), then /workspace/session-memory
# Prints nothing when none does. No clone is made here: a second clone
# would split the store into a copy one writer writes and a copy
# another reads.
# Mirrored pair: resolveRoot in the thread-ledger skill's store/io.mjs
# is the authoritative order for the session-memory store; this copy
# lets handing-off find it without the ledger. A change to the order
# changes both.
handoff_store_root() {
    local candidate session_root=""
    if [ -n "${HANDOFF_STORE:-}" ]; then
        [ -d "$HANDOFF_STORE/.git" ] && printf '%s\n' "$HANDOFF_STORE"
        return 0
    fi
    [ -n "${SESSION_MEMORY_URL:-}" ] || return 0
    if [ -f "$HOME/.claude/session.env" ]; then
        session_root=$(sed -n 's/^SESSION_ROOT=//p' "$HOME/.claude/session.env" | tail -1)
    fi
    local repo_name=${SESSION_MEMORY_URL%/}
    repo_name=$(basename "$repo_name" .git)
    for candidate in "${SESSION_MEMORY_ROOT:-}" \
                     "${session_root:+$session_root/$repo_name}" \
                     /workspace/session-memory; do
        if [ -n "$candidate" ] && [ -d "$candidate/.git" ]; then
            printf '%s\n' "$candidate"
            return 0
        fi
    done
}

# Print a session's directory in the store, relative to its root.
#   $1  session id
handoff_store_dir() {
    printf 'handoffs/sessions/%s\n' "$1"
}

# Print text with the values of the store URL variables replaced by
# their names, so a git error can be forwarded without its URL.
#   $1  text
handoff_store_redact() {
    local text=$1 name
    for name in SESSION_MEMORY_URL DECISION_MEMORY_URL EVIDENCE_MEMORY_URL; do
        if [ -n "${!name:-}" ]; then
            text=${text//"${!name}"/\$$name}
        fi
    done
    printf '%s\n' "$text"
}

# Print the branch of the store's clone that pushes go to: its upstream
# branch when it has one, else the branch of the same name.
#   $1  the store's root
# Prints nothing on a detached HEAD.
handoff_store_branch() {
    local upstream
    upstream=$(git -C "$1" rev-parse --abbrev-ref --symbolic-full-name '@{upstream}' 2>/dev/null || true)
    if [ -n "$upstream" ]; then
        printf '%s\n' "${upstream#origin/}"
    else
        git -C "$1" symbolic-ref --quiet --short HEAD || true
    fi
}

# Push a session's state, and its draft when given, to the store.
#   $1  session id
#   $2  the local state file
#   $3  the local draft; optional
# Returns 0 once origin holds both files; 1 with the reason on stderr
# when no store took them: no clone, no session id, a detached HEAD, or
# a commit or push that failed after three attempts. Git's own error is
# forwarded with the store URLs replaced by their variable names.
handoff_store_push() {
    local session=$1 state=$2 draft=${3:-} root dir branch out attempt
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
    branch=$(handoff_store_branch "$root")
    if [ -z "$branch" ]; then
        echo "handing-off: the store clone $root is on no branch" >&2
        return 1
    fi
    dir=$(handoff_store_dir "$session")
    mkdir -p "$root/$dir"
    cp "$state" "$root/$dir/state.json"
    if [ -n "$draft" ]; then
        cp "$draft" "$root/$dir/draft.md"
        handoff_state_set "$root/$dir/state.json" draft_path "$dir/draft.md"
    fi
    if ! out=$(git -C "$root" add -- "$dir" 2>&1); then
        echo "handing-off: git add in $root failed: $(handoff_store_redact "$out")" >&2
        return 1
    fi
    if ! git -C "$root" diff --cached --quiet -- "$dir"; then
        if ! out=$(git -C "$root" -c user.name=handing-off -c user.email=noreply@anthropic.com \
                       commit -q -m "handoff: $session $(handoff_json_field phase "$(cat "$state")")" \
                       -- "$dir" 2>&1); then
            echo "handing-off: commit in $root failed: $(handoff_store_redact "$out")" >&2
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
        if ! git -C "$root" -c user.name=handing-off -c user.email=noreply@anthropic.com \
                 pull -q --rebase --autostash origin "$branch" > /dev/null 2>&1; then
            git -C "$root" rebase --abort > /dev/null 2>&1 || true
        fi
    done
    echo "handing-off: push from $root to $branch failed after $attempt attempts:" \
         "$(handoff_store_redact "$out")" >&2
    return 1
}

# Restore a session's pushed state, and its draft, from the store.
#   $1  session id
#   $2  the local state file to write
#   $3  the local draft to write
# Returns 0 once the state is restored, with draft_path naming the
# local draft when the store held one; 1 when the store holds no state
# for the session; 2, with the reason on stderr, when no store answers.
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
    if ! out=$(git -C "$root" fetch -q origin "$branch" 2>&1); then
        echo "handing-off: fetch in $root failed: $(handoff_store_redact "$out")" >&2
        return 2
    fi
    dir=$(handoff_store_dir "$session")
    text=$(git -C "$root" show "FETCH_HEAD:$dir/state.json" 2>/dev/null) || return 1
    mkdir -p "$(dirname "$state")" "$(dirname "$draft")"
    printf '%s\n' "$text" > "$state.tmp.$$"
    mv -f "$state.tmp.$$" "$state"
    if git -C "$root" show "FETCH_HEAD:$dir/draft.md" > "$draft.tmp.$$" 2>/dev/null; then
        mv -f "$draft.tmp.$$" "$draft"
        handoff_state_set "$state" draft_path "$draft"
    else
        rm -f "$draft.tmp.$$"
        handoff_state_set "$state" draft_path ""
    fi
}
