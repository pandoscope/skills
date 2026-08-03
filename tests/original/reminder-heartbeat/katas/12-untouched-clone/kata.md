# A clone the session never touched

**Incident:** 2026-08-03, found the first time the heartbeat was pointed
at a real session rather than at fixtures. Six of the eight clones sat
on the session's designated branch with no upstream — created at
session start, never worked in, never pushed. Check 2 called every one
of them unpushed work and would have blocked every turn over repos the
session had not opened.

A branch with no upstream is not evidence of unpushed work. It is
evidence of a branch that was never pushed, which is the normal state
of a clone nobody has written to. What matters is whether the clone
holds a commit that exists nowhere on the remote — and asking that
question directly answers both cases at once, without needing an
upstream to be configured at all.

This is the failure mode that kills reminder systems socially, arriving
through the check that was supposed to be the easy one: a reminder that
fires on turns where nothing is wrong trains its reader to dismiss the
turns where something is.

## What the fixture freezes

A turn whose summary is current and whose ledger event landed, with a
clone on a branch that has no upstream and carries no commit of its
own.

## Expected

Silence. Exit 0, one seal — the clone has nothing to push.
