# The identity is consistent everywhere, and names nobody the key knows

**Measured, 2026-08-15:** a push was refused `GH013 — commits must have
verified signatures`, for a commit that was signed, by a key registered
on the account, with a good signature. The commit's author and
committer were `Claude <noreply@anthropic.com>`; the key's uid was
`pando-ramet <313099516+…@users.noreply.github.com>`. The forge
verifies the signature *and* binds it to an identity — a signature it
cannot bind renders Unverified, and the ruleset refuses it.

Kata 63's clone-local override is the same failure from the other
direction, and its check does not see this one: nothing was overridden.
The global config was wrong, so every clone agreed, and check 15's
"all clones use the global identity" is exactly true and exactly
useless.

The chain that produced it, and why it recurs: the harness resets the
global identity to its own default at every resume. `ensure-signing.sh`
is what re-derives the identity from the key's uid — but it reports and
`exit 0`s when its signing probe fails, before it writes the identity.
So one broken probe leaves a session that signs correctly and attributes
to nobody, for as long as the session lasts. It was diagnosed twice in
one day as a key-registration problem, because every local signal —
`%G?` answering `U`, both keys present on the account — says the key is
fine. It is. The identity is not.

## What the fixture freezes

A turn that is otherwise entirely healthy, with no local override
anywhere. The global identity is the harness default; the configured
signing key's uid names someone else.

## Expected

Check `identity-names-key` fires, naming the configured key, the uid it
carries, and the identity git would actually stamp.

Unlike kata 63, the fix here CORRECTS rather than unsets: there is no
lower layer to fall back to, and the key's own uid is the authority the
identity is derived from.

  git config --global user.email '<the key's uid address>'
  git config --global user.name  '<the key's uid name>'

The check reads the uid from the key, never from a second copy of the
address: a constant repeated in the check is one more place to drift
from the key, which is the defect it exists to catch.
