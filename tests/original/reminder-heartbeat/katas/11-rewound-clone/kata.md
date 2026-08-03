# A clone rolled back behind its own pushed branch

**Incident:** 2026-08-03, this session. A resume rolled the container's
local state back. `skills` came up six commits behind a branch it had
already pushed, with no reflog entry for the missing commits; `meta`
came up holding `origin/main` on a branch whose own tip was two commits
further on, and a third branch — with an open PR — was absent
altogether.

Nothing was lost, because everything had been pushed. What makes it
dangerous is how it presents: the working tree is clean, the branch
name is the expected one, every file is there. Every routine signal
agrees the clone is fine. The next turn builds on a stale base, and the
push that would have been rejected gets forced instead.

Check 2 as first built could not see this. It asked whether the clone
was **ahead** of origin — unpushed work — and was blind to **behind**.
Both are divergence from the pushed branch; only one was checked, and
the unchecked one is the direction that arrives silently.

## Order

Behind is reported before ahead. A clone that is both has to reconcile
before it can push, so naming the push first would hand over a command
that cannot succeed.

## What the fixture freezes

A turn whose summary is current and whose ledger event landed, with a
clone whose branch sits one commit behind the same branch on origin,
tree clean.

## Expected

Check 2 fires, naming the clone and the fast-forward that reconciles
it. `--ff-only` is deliberate: it succeeds for a plain rollback and
fails loudly for a genuine divergence, rather than quietly inventing a
merge.
