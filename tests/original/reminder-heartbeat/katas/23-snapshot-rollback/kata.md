# The rollback check 2 cannot see

**A documented limit, not a defect** — and a correction to kata 11.

Kata 11 models the rollback as `push` then `reset --hard`, which leaves
the remote-tracking ref where the push put it, so `HEAD..@{upstream}`
counts the missing commits and check 2 fires. The **measured** incident
(pandoscope/meta#47) was not that. The container restored the whole
working directory, `.git` included, so the remote-tracking refs rolled
back with everything else. Both sides of the comparison moved together
and the count is zero.

Measured 2026-08-04, snapshotting `.git` before a push and restoring it
after:

```text
git status: ## claude/w...origin/claude/w      (no divergence shown)
HEAD..@{upstream} = 0
heartbeat: exit 0, sealed
```

So check 2 passes on the exact incident skills#64 was written for. That
claim in its PR body was wrong and is corrected there.

## Why this is not fixed here

Seeing it requires asking the remote, and the only local refs that
would show it rolled back too. A fetch per clone at every turn end buys
this one case at the cost of network on every turn — the wrong trade
for a check whose job is to be cheap enough to run always.

The SessionStart report (pandoscope/meta#48) does fetch, once, at the
moment a resume would have produced the rollback. That is where this
case is covered, and the division of labour is deliberate: check 2
watches the branch continuously with local data, layer 1 catches the
restore at the one instant it happens.

## What this kata pins

That check 2 **passes** here, so nobody later reads its silence as
coverage. If a future change makes it fetch, this kata fails and its
`kata.md` is where the trade-off was argued.
