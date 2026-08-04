# The decision store is named but not cloned here

The store's own convention is to **clone fresh per session** rather than
reuse an attached checkout, so `DECISION_MEMORY_URL` being set says
nothing about a checkout existing in this session. A hook that assumed
one — or worse, derived a conventional path and read whatever sat there
— would be reporting on a directory nobody wrote to.

This is the third shape of "nothing was examined", beside an unset
variable and a store that is not a clone. All three are `unconfigured`,
because the compliance log is the instrument that answers whether these
reminders change behaviour, and an instrument that files absence as
health cannot answer it.

## What the fixture freezes

A marked commit, `DECISION_MEMORY_URL` naming a store, and no clone of
that store among the session's repos.

## Expected

The turn seals — an unconfigured check never blocks — and check 4 is
logged `unconfigured`, never `pass`.
