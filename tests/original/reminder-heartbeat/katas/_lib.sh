#!/usr/bin/env bash
# Repo states a kata's setup.sh can build, so no kata reimplements the
# git dance. Sourced from the staged kata directory, where the runner
# places a copy of this file; $PWD is that directory.
#
#   kata_repo <name> clean     committed and pushed — check 2 passes
#   kata_repo <name> dirty     working tree has uncommitted changes
#   kata_repo <name> unpushed  committed, ahead of its upstream
#   kata_repo <name> marked-rebased <committed> <authored>
#                              a marker whose two dates differ, as a
#                              rebase leaves them
#
# Every repo gets a real upstream (a bare clone under .origins/), because
# "pushed" is HEAD against origin and a repo without one cannot express
# the difference.
#
# Commit dates are fixed, never "now". A fixture built at test time would
# otherwise date every commit after the kata's turn began, and a check
# that asks "did this clone gain a commit during the turn?" would answer
# yes for a clone the kata never touched — the fixture's own age leaking
# into the thing under test.
SEEDED=2020-01-01T00:00:00Z

set -eu

kata_repo() {
    name=$1
    state=$2
    # Third argument: when the "this turn" commit happened. Only the
    # states that model activity during the turn under test need it.
    when=${3:-$SEEDED}
    # Fourth argument: when the work was AUTHORED, when that differs
    # from when it was committed — which is what a rebase produces, and
    # the only way to express "written earlier, landed now".
    authored=${4:-$when}
    origin="$PWD/.origins/$name.git"
    # KATA_CLONE_DIR moves the checkout out of repos/ — workspace models
    # ensure-stores.sh, which clones stores under the workspace root
    # rather than the repo root (#72).
    work="$PWD/${KATA_CLONE_DIR:-repos}/$name"

    mkdir -p "$PWD/.origins" "$(dirname "$work")"
    git init -q --bare "$origin"
    git init -q -b claude/kata "$work"
    git -C "$work" config user.email kata@example.test
    git -C "$work" config user.name kata
    git -C "$work" remote add origin "$origin"

    echo "seed" > "$work/README.md"
    git -C "$work" add -A
    GIT_COMMITTER_DATE="$SEEDED" git -C "$work" commit -q --date "$SEEDED" -m "chore: seed"
    git -C "$work" push -q -u origin claude/kata

    case "$state" in
        clean) ;;
        dirty)
            echo "edited but never committed" >> "$work/README.md"
            ;;
        unpushed)
            echo "committed but never pushed" >> "$work/README.md"
            git -C "$work" add -A
            GIT_COMMITTER_DATE="${when:-$SEEDED}" git -C "$work" commit -q --date "${when:-$SEEDED}" -m "feat: the work this turn did"
            ;;
        committed-this-turn)
            # Work that landed and was pushed during the turn under
            # test — evidence the turn touched this clone, independent
            # of anything the turn says about itself.
            echo "the work this turn did" >> "$work/README.md"
            git -C "$work" add -A
            GIT_COMMITTER_DATE="${when:-$SEEDED}" git -C "$work" commit -q --date "${when:-$SEEDED}" -m "fix: the parser"
            git -C "$work" push -q origin claude/kata
            ;;
        untouched)
            # A clone the session never worked in: put on a branch that
            # was never pushed, carrying no commit of its own. Every
            # commit it holds is already on the remote under another
            # name, so there is nothing to push and nothing to report.
            git -C "$work" checkout -q -b claude/never-pushed
            ;;
        marked-this-turn)
            # A decision marker landed in code during the turn under
            # test. The marker is the observable half of
            # documenting-decisions; the record in the decision store is
            # the other, and check 4 exists to notice when a turn wrote
            # one and not the other.
            printf '%s\n' "// DECISION:ARCH — the seal sits outside the state machine" \
                >> "$work/core.mjs"
            git -C "$work" add -A
            GIT_COMMITTER_DATE="${when:-$SEEDED}" git -C "$work" commit -q \
                --date "${when:-$SEEDED}" -m "feat: the decision this turn made"
            git -C "$work" push -q origin claude/kata
            ;;
        marked-rebased)
            # A marker that reached the branch by rebase or rebase-merge:
            # the commit is new to the history, so its COMMITTER date is
            # the moment it landed, while the AUTHOR date the rewrite
            # preserves says when the reasoning was actually available to
            # write down. Which of the two the check reads is the whole
            # question — pass `authored` before the turn boundary for an
            # earlier turn's debt, after it for this turn's.
            printf '%s\n' "// DECISION:ARCH — the seal sits outside the state machine" \
                >> "$work/core.mjs"
            git -C "$work" add -A
            GIT_COMMITTER_DATE="$when" git -C "$work" commit -q \
                --date "$authored" -m "feat: a decision that landed by rebase"
            git -C "$work" push -q origin claude/kata
            ;;
        marked-fixture)
            # The marker text lands inside a kata fixture tree — a
            # string staged as test data so check 4 can find it in the
            # THROWAWAY repo the fixture builds, not a decision about
            # the fixture file itself (#86). Check 4 must not bill it
            # to the turn that staged it.
            mkdir -p "$work/tests/original/some-check/katas"
            printf '%s\n' 'printf "// DECISION:ARCH — staged for the check to find" >> "$target/core.mjs"' \
                >> "$work/tests/original/some-check/katas/_lib.sh"
            git -C "$work" add -A
            GIT_COMMITTER_DATE="${when:-$SEEDED}" git -C "$work" commit -q \
                --date "${when:-$SEEDED}" -m "test: stage a marker fixture for the check"
            git -C "$work" push -q origin claude/kata
            ;;
        marked-earlier)
            # The same marker, committed before the turn began. The turn
            # that wrote it is the turn that owed the record, and a
            # check keyed to the working tree rather than to the turn
            # would collect every marker the repo ever accumulated.
            printf '%s\n' "// DECISION:ARCH — the seal sits outside the state machine" \
                >> "$work/core.mjs"
            git -C "$work" add -A
            GIT_COMMITTER_DATE="$SEEDED" git -C "$work" commit -q \
                --date "$SEEDED" -m "feat: a decision from an earlier turn"
            git -C "$work" push -q origin claude/kata
            ;;
        behind)
            # Work reaches origin, then the local branch is moved back —
            # the shape a rolled-back container comes up in. The tree is
            # clean and the branch name is right, so nothing but the
            # comparison against origin can tell.
            echo "landed upstream" >> "$work/README.md"
            git -C "$work" add -A
            GIT_COMMITTER_DATE="${when:-$SEEDED}" git -C "$work" commit -q --date "${when:-$SEEDED}" -m "feat: work that reached origin"
            git -C "$work" push -q origin claude/kata
            git -C "$work" reset -q --hard HEAD~1
            ;;
        *)
            echo "kata_repo: unknown state '$state' for repo '$name'" >&2
            exit 1
            ;;
    esac
}

# The decision store: a decision-memory clone seeded with one record
# from before the turn, so "a record exists" can never be what makes
# check 4 pass — only a record that arrived during the turn can.
#
#   kata_decisions empty              no record landed this turn
#   kata_decisions recorded <when>    a record landed at <when>
#
# Third argument: the directory the checkout lives under (default
# repos). `workspace` models ensure-stores.sh, whose store clones sit
# under ${WORKSPACE_ROOT:-/workspace}, not under the repo root (#72).
kata_decisions() {
    dstate=$1
    dwhen=${2:-$SEEDED}
    dwhere=${3:-repos}
    KATA_CLONE_DIR=$dwhere kata_repo decision-memory clean
    store="$PWD/$dwhere/decision-memory"

    mkdir -p "$store/decisions"
    printf '%s\n' '{"id":"20200101T000000Z-seed","type":"decision"}' \
        > "$store/decisions/20200101T000000Z-seed.json"
    git -C "$store" add -A
    GIT_COMMITTER_DATE="$SEEDED" git -C "$store" commit -q \
        --date "$SEEDED" -m "chore: seed the corpus"
    git -C "$store" push -q origin claude/kata

    if [ "$dstate" = recorded ]; then
        printf '%s\n' '{"id":"20260803T210600Z-seal-outside-machine","type":"decision"}' \
            > "$store/decisions/20260803T210600Z-seal-outside-machine.json"
        git -C "$store" add -A
        GIT_COMMITTER_DATE="$dwhen" git -C "$store" commit -q \
            --date "$dwhen" -m "record: the seal sits outside the state machine"
        git -C "$store" push -q origin claude/kata
    fi
}

# A second checkout of the decision store, cloned from the origin
# kata_decisions already built — the duplicate the platform resurrects
# from snapshots on any resume (#72), so discovery has to be correct
# with both present.
#
#   kata_decisions_twin <dir>                  bare duplicate
#   kata_decisions_twin <dir> open             recorder session open here
#   kata_decisions_twin <dir> open-recorded    ...and a record landed here
kata_decisions_twin() {
    twhere=$1
    tstate=${2:-}
    twin="$PWD/$twhere/decision-memory"
    mkdir -p "$PWD/$twhere"
    # `-b`, because the bare origin's HEAD still points at a branch
    # nothing ever pushed — without it the clone checks out nothing and
    # the twin has no working tree to stage state in.
    git clone -q -b claude/kata "$PWD/.origins/decision-memory.git" "$twin"
    case "$tstate" in
        open|open-recorded)
            printf '%s\n' '{"session":"20260803T210000Z","branch":"session/20260803T210000Z"}' \
                > "$twin/.recorder-session.json"
            ;;
    esac
    if [ "$tstate" = open-recorded ]; then
        # Untracked, exactly as the recorder leaves a record before its
        # commit lands — check 4 counts it either way.
        printf '%s\n' '{"id":"20260803T210600Z-seal-outside-machine","type":"decision"}' \
            > "$twin/decisions/20260803T210600Z-seal-outside-machine.json"
    fi
}
