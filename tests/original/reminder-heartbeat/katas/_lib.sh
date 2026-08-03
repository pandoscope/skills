#!/usr/bin/env bash
# Repo states a kata's setup.sh can build, so no kata reimplements the
# git dance. Sourced from the staged kata directory, where the runner
# places a copy of this file; $PWD is that directory.
#
#   kata_repo <name> clean     committed and pushed — check 2 passes
#   kata_repo <name> dirty     working tree has uncommitted changes
#   kata_repo <name> unpushed  committed, ahead of its upstream
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
    origin="$PWD/.origins/$name.git"
    work="$PWD/repos/$name"

    mkdir -p "$PWD/.origins" "$PWD/repos"
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
kata_decisions() {
    dstate=$1
    dwhen=${2:-$SEEDED}
    kata_repo decision-memory clean
    store="$PWD/repos/decision-memory"

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
