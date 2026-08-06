# A term that lives locally and never leaves

**Rule (skills#46, check 7):** the scan target is outgoing diffs and
rendered files, not the working tree — a term may legitimately live in
env or scratchpad and must only never leave.

## What the fixture freezes

`PUSH_BLOCKLIST` names a term that exists twice in the session: as the
environment value itself and in a gitignored file inside a clone.
Nothing outgoing carries it.

## Expected

The turn seals. A check that fired here would train sessions to purge
secrets from the places they are supposed to live.
