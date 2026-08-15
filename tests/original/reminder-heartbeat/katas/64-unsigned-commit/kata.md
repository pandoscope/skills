# Signing configured, commit unsigned

The org's rulesets refuse an unsigned commit on every public repo, so
an unsigned commit is not a style problem — it is work that cannot
land. But nothing local complains: the commit succeeds, the tree is
clean, and the refusal arrives at push time (GH013), attributed to
whatever turn happens to be pushing rather than the one that made it.

## What the fixture freezes

A clone whose own config says `commit.gpgsign true`, carrying a commit
made during the turn with no signature.

## Expected

Check 16 fires, naming the clone and the commit.

The gate is the clone's own config, not an assumption: a deployment
that does not sign is not failing, and a check that complained every
turn about a deliberate choice would teach its reader to skip the
report that matters. Kata 63's clone signs nothing and stays green for
exactly that reason.
