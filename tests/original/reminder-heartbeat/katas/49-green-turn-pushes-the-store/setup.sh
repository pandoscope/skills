#!/usr/bin/env bash
# The store is a real clone with an origin — the shape ensure-stores.sh
# leaves it in. A green turn's seal must reach that origin with no
# manual push anywhere.
set -eu
. ./_lib.sh
kata_repo skills clean

origin="$PWD/.origins/session-store.git"
git init -q --bare -b main "$origin"
work="$PWD/store"
# The runner stages the checked-in store/ fixture first; fold that
# content into the clone's seed commit.
mv "$work" "$PWD/store-seed"
git clone -q "$origin" "$work" 2>/dev/null
cp -r "$PWD/store-seed/." "$work/"
rm -rf "$PWD/store-seed"
git -C "$work" config user.email kata@example.test
git -C "$work" config user.name kata
git -C "$work" add -A
GIT_COMMITTER_DATE="$SEEDED" git -C "$work" commit -q --date "$SEEDED" -m "chore: seed the store"
git -C "$work" push -q -u origin main
