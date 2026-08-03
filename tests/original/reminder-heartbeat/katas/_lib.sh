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

set -eu

kata_repo() {
    name=$1
    state=$2
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
    git -C "$work" commit -q -m "chore: seed"
    git -C "$work" push -q -u origin claude/kata

    case "$state" in
        clean) ;;
        dirty)
            echo "edited but never committed" >> "$work/README.md"
            ;;
        unpushed)
            echo "committed but never pushed" >> "$work/README.md"
            git -C "$work" add -A
            git -C "$work" commit -q -m "feat: the work this turn did"
            ;;
        committed-this-turn)
            # Work that landed and was pushed during the turn under
            # test — evidence the turn touched this clone, independent
            # of anything the turn says about itself.
            echo "the work this turn did" >> "$work/README.md"
            git -C "$work" add -A
            git -C "$work" commit -q -m "fix: the parser"
            git -C "$work" push -q origin claude/kata
            ;;
        untouched)
            # A clone the session never worked in: put on a branch that
            # was never pushed, carrying no commit of its own. Every
            # commit it holds is already on the remote under another
            # name, so there is nothing to push and nothing to report.
            git -C "$work" checkout -q -b claude/never-pushed
            ;;
        behind)
            # Work reaches origin, then the local branch is moved back —
            # the shape a rolled-back container comes up in. The tree is
            # clean and the branch name is right, so nothing but the
            # comparison against origin can tell.
            echo "landed upstream" >> "$work/README.md"
            git -C "$work" add -A
            git -C "$work" commit -q -m "feat: work that reached origin"
            git -C "$work" push -q origin claude/kata
            git -C "$work" reset -q --hard HEAD~1
            ;;
        *)
            echo "kata_repo: unknown state '$state' for repo '$name'" >&2
            exit 1
            ;;
    esac
}
