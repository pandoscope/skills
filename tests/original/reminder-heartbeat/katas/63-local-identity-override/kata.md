# A local git identity override, and the signature nobody can bind

**Measured, 2026-08-11:** all 35 commits of a rebased decision batch
showed **Unverified** on the forge. They were signed, correctly, by the
key the environment configures. The key names one identity; the clone
carried a local `user.email` the harness had written at attach time,
and local beats global — so every commit was signed by a key that did
not name its author, over an address belonging to no account.

Nothing errored. `git log --format=%G?` answered `U` — good signature,
unknown validity — which reads like success and says nothing about
attribution. The failure appeared only on the forge, after the push,
where the verified-signatures ruleset made the commits unmergeable and
the repair was a second rewrite of every commit already made.

Six of that session's eight clones were clean and two were not, which
is why it looked like a signing problem rather than a config one: the
same key, in the same repo, verified for another session.

## What the fixture freezes

A turn that is otherwise entirely healthy — summary current, ledger
event landed, clone committed and pushed — with one clone carrying a
local `user.email`. Health everywhere else is the point: the override
is invisible to every other check.

## Expected

Check 15 fires, naming the clone and the key, and offers the unset —
never a corrected value, because one identity held in one place cannot
drift from the key's uid later.
