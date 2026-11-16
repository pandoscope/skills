# shellcheck shell=bash
# Which git clone is the store, and which branch of it a push goes to
# (skills#267). Sourced by store.sh.

# Print the directory of the store's clone.
# With HANDOFF_STORE set, the place an installing project names for its
# session artifacts, that directory when it holds a git clone.
# Otherwise, with SESSION_MEMORY_URL set, the first of these that is
# set or exists: SESSION_MEMORY_ROOT; the harness's clone (SESSION_ROOT
# in ~/.claude/session.env joined with the store repository's name);
# /workspace/session-memory. The one chosen must be a clone whose origin
# names the same repository as SESSION_MEMORY_URL.
# Prints nothing, with the reason on stderr, when the chosen directory
# fails that; nothing and no reason when nothing names a store.
# No clone is made here: a second clone would split the store into a
# copy one writer writes and a copy another reads.
# Mirrored pair: resolveRoot and verifyOrigin in the thread-ledger
# skill's store/io.mjs are the authoritative lookup for the
# session-memory store; this copy lets handing-off find it without the
# ledger. A change to either side changes both.
handoff_store_root() {
    local named="" session_root="" repo_name origin
    if [ -n "${HANDOFF_STORE:-}" ]; then
        [ -d "$HANDOFF_STORE/.git" ] && printf '%s\n' "$HANDOFF_STORE"
        return 0
    fi
    [ -n "${SESSION_MEMORY_URL:-}" ] || return 0
    repo_name=$(basename "${SESSION_MEMORY_URL%/}" .git)
    if [ -n "${SESSION_MEMORY_ROOT:-}" ]; then
        named=$SESSION_MEMORY_ROOT
    else
        if [ -f "$HOME/.claude/session.env" ]; then
            session_root=$(sed -n 's/^SESSION_ROOT=//p' "$HOME/.claude/session.env" | tail -1)
        fi
        if [ -n "$session_root" ] && [ -d "$session_root/$repo_name/.git" ]; then
            named="$session_root/$repo_name"
        else
            named=/workspace/session-memory
        fi
    fi
    if [ ! -d "$named/.git" ]; then
        echo "handing-off: no session-memory clone at $named" >&2
        return 0
    fi
    origin=$(git -C "$named" remote get-url origin 2>/dev/null || true)
    if [ "$(handoff_store_tail "$origin")" != "$(handoff_store_tail "$SESSION_MEMORY_URL")" ]; then
        echo "handing-off: $named has origin $(handoff_store_tail "$origin"), but" \
             "SESSION_MEMORY_URL names $(handoff_store_tail "$SESSION_MEMORY_URL");" \
             "refusing the wrong store" >&2
        return 0
    fi
    printf '%s\n' "$named"
}

# Print the owner/name tail of a repository URL or path, lower-cased,
# the way the ledger's tail() compares origins.
#   $1  URL or path
handoff_store_tail() {
    local trimmed=${1%/}
    trimmed=${trimmed%.git}
    printf '%s\n' "$trimmed" | tr ':' '/' | awk -F/ '
        { n = 0; for (i = 1; i <= NF; i++) if ($i != "") part[++n] = $i
          if (n >= 2) print tolower(part[n - 1] "/" part[n]); else if (n == 1) print tolower(part[1]) }'
}

# Print the branch of the store's clone that pushes go to: the
# remote's default branch (origin/HEAD, else main), when the clone is
# on it.
#   $1  the store's root
# Prints nothing, with the reason on stderr, when the clone is on
# another branch or a detached HEAD: a push of HEAD would publish that
# branch's commits to the default branch. The ledger refuses the same
# (requireDefaultBranch in its store/writes.mjs).
handoff_store_branch() {
    local target head
    target=$(git -C "$1" symbolic-ref -q --short refs/remotes/origin/HEAD 2>/dev/null || true)
    target=${target#origin/}
    [ -n "$target" ] || target=main
    head=$(git -C "$1" symbolic-ref -q --short HEAD 2>/dev/null || true)
    if [ "$head" != "$target" ]; then
        echo "handing-off: the store clone $1 is on ${head:-a detached HEAD}," \
             "not its default branch $target; nothing was pushed" >&2
        return 0
    fi
    printf '%s\n' "$target"
}
