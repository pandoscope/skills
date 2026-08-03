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
        *)
            echo "kata_repo: unknown state '$state' for repo '$name'" >&2
            exit 1
            ;;
    esac
}
