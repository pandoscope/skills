# The store lives only under the workspace root

**Incident class:** the gap skills#72 names. `ensure-stores.sh` clones
the three stores under `${WORKSPACE_ROOT:-/workspace}`, which is not
under the repo root — so in a session where decision-memory is not a
user-added source, check 4 found no matching origin among the clones
it scanned, logged `unconfigured`, and marker turns passed unchecked.
Silent non-enforcement, in exactly the session shape the install is
building toward.

## What the fixture freezes

A marker committed this turn, a record landed this turn — and the
decision store checked out under `workspace/` only, invisible to a
discovery that stops at the repo root.

## Expected

The turn seals, and check 4 reports **pass**, not `unconfigured`: the
record was there to see, in the checkout the recorder actually wrote.
